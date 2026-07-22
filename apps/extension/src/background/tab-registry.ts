import type { ChatMessage } from "@slop-ai/consumer/browser";
import { affordancesToTools, formatTree } from "@slop-ai/consumer/browser";
import { isApproved, saveApproval } from "../lib/approvals";
import { classifyDiscoveryTarget, pageOriginOf, type TargetClassification } from "../lib/origin";
import type {
  BackgroundMessage,
  BridgeMessageFromDesktop,
  ProviderMessage,
  ProviderSpec,
  TabProviderSummary,
} from "../types";
import * as bridge from "./bridge-client";
import { initConversation, runTurn } from "./chat-engine";
import { type HelloIdentity, Session } from "./session";

interface DiscoveryEntry extends ProviderSpec {
  providerKey: string;
  /** Origin binding per spec/core/transport.md § Web discovery. */
  classification: TargetClassification;
  /** Same-origin targets are implicitly approved; cross-origin needs the user. */
  approved: boolean;
  /** Identity from the provider's hello message. Announcements wait for this. */
  hello: { id: string; name: string } | null;
}

interface TabEntry {
  port: chrome.runtime.Port;
  discoveries: DiscoveryEntry[];
  session: Session | null;
  conversation: ChatMessage[];
  processing: boolean;
  desktopRelays: Set<string>;
}

const tabs = new Map<number, TabEntry>();
const discoveryIndex = new Map<string, { tabId: number; providerKey: string; spec: ProviderSpec }>();

function send(port: chrome.runtime.Port, msg: BackgroundMessage) {
  try {
    port.postMessage(msg);
  } catch (e) {
    console.warn("[slop] failed to post background message to content script:", e);
  }
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

function specKey(spec: ProviderSpec): string {
  return `${spec.transport}:${spec.endpoint ?? ""}`;
}

function pageUrlOf(entry: TabEntry): string {
  return entry.port.sender?.url ?? entry.port.sender?.tab?.url ?? "";
}

function approvedSpecs(entry: TabEntry): ProviderSpec[] {
  return entry.discoveries.filter((d) => d.approved).map(({ transport, endpoint }) => ({ transport, endpoint }));
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
  lastStatus.delete(tabId);
}

export async function setDiscoveries(tabId: number, providers: ProviderSpec[]): Promise<void> {
  const entry = tabs.get(tabId);
  if (!entry) return;

  const pageUrl = pageUrlOf(entry);
  const pageOrigin = pageOriginOf(pageUrl) ?? "opaque-origin";

  const previous = new Map(entry.discoveries.map((d) => [d.providerKey, d]));

  const next: DiscoveryEntry[] = [];
  for (const [index, spec] of providers.entries()) {
    const providerKey = makeProviderKey(tabId, spec, index);
    const prior = previous.get(providerKey);

    // Origin binding: a ws target declared by the page is only trusted when
    // same-origin (or both loopback). Cross-origin targets — including a
    // loopback target on a non-loopback page — require explicit approval.
    const classification: TargetClassification =
      spec.transport === "ws" && spec.endpoint ? classifyDiscoveryTarget(pageUrl, spec.endpoint) : "same-origin";

    let approved = classification === "same-origin";
    if (!approved && spec.endpoint) {
      approved = prior?.approved === true || (await isApproved(pageOrigin, spec.endpoint));
    }

    next.push({
      ...spec,
      providerKey,
      classification,
      approved,
      hello: prior?.hello ?? null,
    });
  }

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

  // Index + announce. Only approved discoveries are indexed for the desktop
  // bridge — an unapproved cross-origin provider is never merged or relayed.
  // Announcements themselves wait for the provider's hello (see onProviderHello).
  for (const d of next) {
    if (!d.approved) continue;
    discoveryIndex.set(d.providerKey, { tabId, providerKey: d.providerKey, spec: d });
    announceDiscovery(tabId, entry, d);
  }

  syncSession(tabId);
}

function syncSession(tabId: number): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  const specs = approvedSpecs(entry);

  if (entry.session) {
    if (specs.some((p) => p.transport === "postmessage")) {
      send(entry.port, { type: "bridge-active", active: true });
    }
    entry.session.sync(specs);
  } else if (specs.length > 0) {
    // Auto-connect on first approved discovery
    ensureSession(tabId);
  }

  updateBridgeControl(tabId);
}

export async function ensureSession(tabId: number): Promise<boolean> {
  const entry = tabs.get(tabId);
  if (!entry) return false;

  if (entry.session) return true;

  const specs = approvedSpecs(entry);
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
    (spec, hello) => onProviderHello(tabId, spec, hello),
  );
  entry.session = session;
  await session.connect(specs);

  updateBridgeControl(tabId);
  return true;
}

/**
 * Approve a pending cross-origin discovery. Persists the (page origin ->
 * target URL) approval so the user is asked once, then connects.
 */
export async function approveProvider(tabId: number, providerKey: string): Promise<boolean> {
  const entry = tabs.get(tabId);
  if (!entry) return false;

  const d = entry.discoveries.find((x) => x.providerKey === providerKey);
  if (!d || d.approved) return d?.approved ?? false;
  if (!d.endpoint) return false;

  const pageOrigin = pageOriginOf(pageUrlOf(entry)) ?? "opaque-origin";
  await saveApproval(pageOrigin, d.endpoint);

  d.approved = true;
  discoveryIndex.set(d.providerKey, { tabId, providerKey: d.providerKey, spec: d });
  syncSession(tabId);
  return true;
}

/** Provider summaries for the popup — names come from hello, never the tab title. */
export function getTabProviders(tabId: number): TabProviderSummary[] {
  const entry = tabs.get(tabId);
  if (!entry) return [];

  const tabTitle = entry.port.sender?.tab?.title;

  return entry.discoveries.map((d) => {
    const sessionEntry = entry.session?.getEntryBySpec(d);
    const hello = d.hello ?? sessionEntry?.hello ?? null;
    return {
      providerKey: d.providerKey,
      transport: d.transport,
      endpoint: d.endpoint,
      classification: d.classification,
      approved: d.approved,
      status: d.approved ? (sessionEntry?.status ?? "disconnected") : "pending-approval",
      name: hello?.name ?? d.endpoint ?? (d.transport === "postmessage" ? "In-page provider" : "Provider"),
      fromHello: hello != null,
      tabTitle,
    };
  });
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

export function handleBridgeMessage(msg: BridgeMessageFromDesktop): void {
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

export function relayUp(tabId: number, message: ProviderMessage): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  for (const providerKey of entry.desktopRelays) {
    bridge.relayToDesktop(providerKey, message);
  }
}

export function reannounceAll(): void {
  for (const [tabId, entry] of tabs) {
    for (const d of entry.discoveries) {
      announceDiscovery(tabId, entry, d);
    }
  }
}

// --- Internal helpers ---

/**
 * Record a provider's hello identity and announce it over the bridge.
 * Announcements are deferred until hello so the announced name/id always
 * come from the provider itself — never from the page's tab title.
 */
function onProviderHello(tabId: number, spec: ProviderSpec, hello: HelloIdentity): void {
  const entry = tabs.get(tabId);
  if (!entry) return;

  const key = specKey(spec);
  const d = entry.discoveries.find((x) => specKey(x) === key);
  if (!d) return;

  d.hello = { id: hello.id, name: hello.name };
  announceDiscovery(tabId, entry, d);
}

function announceDiscovery(tabId: number, entry: TabEntry, d: DiscoveryEntry): void {
  // Never announce unapproved cross-origin providers; never announce
  // before the hello identity is known.
  if (!d.approved || !d.hello) return;

  // If the page has postMessage providers (SPA), only announce those —
  // the desktop discovers ws providers on its own. Skip ws providers
  // on the same page to avoid broken duplicates in the desktop sidebar.
  const hasPostMessage = entry.discoveries.some((x) => x.approved && x.transport === "postmessage");
  if (hasPostMessage && d.transport === "ws") return;

  bridge.announceProvider({
    tabId,
    providerKey: d.providerKey,
    provider: {
      id: d.providerKey,
      providerId: d.hello.id,
      name: d.hello.name,
      transport: d.transport,
      url: d.endpoint,
      // Secondary context only ("from tab: ..."), never the identity.
      tabTitle: entry.port.sender?.tab?.title,
    },
  });
}

const lastStatus = new Map<number, string>();

function pushStatus(tabId: number): void {
  const entry = tabs.get(tabId);
  if (!entry?.session) return;

  const status = entry.session.getStatus();
  const prev = lastStatus.get(tabId);
  lastStatus.set(tabId, status);

  send(entry.port, {
    type: "status",
    status,
    providerName: entry.session.providerName,
  });

  // Only push tree on actual transition to connected, not on every
  // redundant status callback while already connected
  if (status === "connected" && prev !== "connected") {
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
