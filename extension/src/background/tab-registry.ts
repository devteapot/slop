import type { ChatMessage } from "@slop-ai/consumer/browser";
import { formatTree, affordancesToTools } from "@slop-ai/consumer/browser";
import type { ProviderSpec, BackgroundMessage } from "../types";
import { Session } from "./session";
import { initConversation, runTurn } from "./chat-engine";
import * as bridge from "./bridge-client";

interface TabEntry {
  port: chrome.runtime.Port;
  discoveries: Array<ProviderSpec & { providerKey: string }>;
  session: Session | null;
  conversation: ChatMessage[];
  processing: boolean;
  desktopRelays: Set<string>;
}

const tabs = new Map<number, TabEntry>();
const discoveryIndex = new Map<string, { tabId: number; providerKey: string; spec: ProviderSpec }>();

function send(port: chrome.runtime.Port, msg: BackgroundMessage) {
  try { port.postMessage(msg); } catch {}
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function makeProviderKey(tabId: number, spec: ProviderSpec, index: number): string {
  if (spec.transport === "ws") {
    return `tab-${tabId}-ws-${encodeKeyPart(spec.endpoint ?? `provider-${index}`)}`;
  }
  return `tab-${tabId}-postmessage-${index}`;
}

// --- Public API ---

export function register(tabId: number, port: chrome.runtime.Port): void {
  tabs.set(tabId, {
    port,
    discoveries: [],
    session: null,
    conversation: initConversation(),
    processing: false,
    desktopRelays: new Set(),
  });
}

export function teardown(tabId: number): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  entry.session?.disconnect();

  // Clear bridge announcements
  for (const d of entry.discoveries) {
    bridge.announceGone(tabId, d.providerKey);
    discoveryIndex.delete(d.providerKey);
  }
  entry.desktopRelays.clear();

  tabs.delete(tabId);
}

export function setDiscoveries(
  tabId: number,
  providers: ProviderSpec[],
): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  const next = providers.map((spec, index) => ({
    ...spec,
    providerKey: makeProviderKey(tabId, spec, index),
  }));

  const nextKeys = new Set(next.map((d) => d.providerKey));

  // Remove stale discoveries
  for (const d of entry.discoveries) {
    if (!nextKeys.has(d.providerKey)) {
      bridge.announceGone(tabId, d.providerKey);
      discoveryIndex.delete(d.providerKey);
      entry.desktopRelays.delete(d.providerKey);
    }
  }

  entry.discoveries = next;

  // Announce discoveries to bridge.
  // If the page has postMessage providers (SPA), only announce those —
  // the desktop can't reach them without the relay. Skip ws providers
  // on the same page to avoid broken duplicates in the desktop sidebar.
  const hasPostMessage = next.some((d) => d.transport === "postmessage");

  for (const d of next) {
    discoveryIndex.set(d.providerKey, { tabId, providerKey: d.providerKey, spec: d });

    if (hasPostMessage && d.transport === "ws") continue; // desktop discovers ws on its own

    bridge.announceProvider({
      tabId,
      providerKey: d.providerKey,
      provider: {
        id: d.providerKey,
        name: entry.port.sender?.tab?.title ?? `Tab ${tabId}`,
        transport: d.transport,
        url: d.endpoint,
      },
    });
  }

  // Create or sync session
  if (entry.session) {
    if (providers.some((p) => p.transport === "postmessage")) {
      send(entry.port, { type: "bridge-active", active: true });
    }
    entry.session.sync(providers);
  } else if (providers.length > 0) {
    // Auto-connect on first discovery
    ensureSession(tabId);
  }

  updateBridgeControl(tabId);
}

export async function ensureSession(tabId: number): Promise<boolean> {
  const entry = tabs.get(tabId);
  if (!entry) return false;

  if (entry.session) return true;

  const specs = entry.discoveries.map(({ transport, endpoint }) => ({ transport, endpoint }));
  if (specs.length === 0) return false;

  // Enable postMessage bridge if needed
  if (specs.some((s) => s.transport === "postmessage")) {
    send(entry.port, { type: "bridge-active", active: true });
  }

  const session = new Session(
    tabId,
    entry.port,
    () => pushStatus(tabId),
    () => pushTree(tabId),
  );
  entry.session = session;
  await session.connect(specs);

  updateBridgeControl(tabId);
  return true;
}

export async function handleUserMessage(tabId: number, text: string): Promise<void> {
  const entry = tabs.get(tabId);
  if (!entry || entry.processing) return;

  if (!(await ensureSession(tabId))) return;

  entry.processing = true;
  try {
    await runTurn(entry.session!, entry.conversation, entry.port, text);
  } finally {
    entry.processing = false;
  }
}

export function getPort(tabId: number): chrome.runtime.Port | undefined {
  return tabs.get(tabId)?.port;
}

export function hasSession(tabId: number): boolean {
  return tabs.get(tabId)?.session != null;
}

// --- Bridge relay ---

export function handleBridgeMessage(msg: any): void {
  if (!msg?.type || typeof msg.providerKey !== "string") return;

  const indexed = discoveryIndex.get(msg.providerKey);
  if (!indexed) return;

  const { tabId } = indexed;
  const entry = tabs.get(tabId);
  if (!entry || indexed.spec.transport !== "postmessage") return;

  if (msg.type === "relay-open") {
    entry.desktopRelays.add(msg.providerKey);
    updateBridgeControl(tabId);
    return;
  }

  if (msg.type === "relay-close") {
    entry.desktopRelays.delete(msg.providerKey);
    updateBridgeControl(tabId);
    return;
  }

  if (msg.type === "slop-relay" && msg.message) {
    updateBridgeControl(tabId);
    send(entry.port, { type: "slop-to-provider", message: msg.message });
  }
}

export function relayUp(tabId: number, message: any): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  for (const providerKey of entry.desktopRelays) {
    bridge.relayToDesktop(providerKey, message);
  }
}

export function reannounceAll(): void {
  for (const [tabId, entry] of tabs) {
    const hasPostMessage = entry.discoveries.some((d) => d.transport === "postmessage");
    for (const d of entry.discoveries) {
      if (hasPostMessage && d.transport === "ws") continue;
      bridge.announceProvider({
        tabId,
        providerKey: d.providerKey,
        provider: {
          id: d.providerKey,
          name: entry.port.sender?.tab?.title ?? `Tab ${tabId}`,
          transport: d.transport,
          url: d.endpoint,
        },
      });
    }
  }
}

// --- Internal helpers ---

function pushStatus(tabId: number): void {
  const entry = tabs.get(tabId);
  if (!entry?.session) return;

  send(entry.port, {
    type: "status",
    status: entry.session.getStatus(),
    providerName: entry.session.providerName,
  });

  if (entry.session.getStatus() === "connected") {
    pushTree(tabId);
  }
}

function pushTree(tabId: number): void {
  const entry = tabs.get(tabId);
  if (!entry?.session) return;

  const tree = entry.session.getMergedTree();
  if (!tree) return;

  send(entry.port, {
    type: "tree",
    formatted: formatTree(tree),
    toolCount: affordancesToTools(tree).tools.length,
  });
}

function updateBridgeControl(tabId: number): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  const active = entry.session != null || entry.desktopRelays.size > 0;
  send(entry.port, { type: "bridge-active", active });
}
