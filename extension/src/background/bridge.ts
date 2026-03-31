/**
 * Bridge client — connects to the desktop app's local WebSocket bridge
 * at ws://localhost:9339/slop-bridge.
 *
 * The bridge only carries provider discovery plus provider-scoped relay
 * messages for desktop-owned postMessage sessions.
 */

import { getPrefs } from "../shared/messages";

const BRIDGE_URL = "ws://127.0.0.1:9339/slop-bridge";
const RETRY_INTERVAL = 5000;

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;
let enabled = true;

export interface BridgeDiscoveryProvider {
  transport: "ws" | "postmessage";
  endpoint?: string;
}

export interface ProviderAnnouncement {
  tabId: number;
  providerKey: string;
  provider: {
    id: string;
    name: string;
    transport: "ws" | "postmessage";
    url?: string;
  };
}

type BridgeMessageHandler = (message: any) => void;

const bridgeMessageHandlers: BridgeMessageHandler[] = [];
const announcedProviders = new Map<string, ProviderAnnouncement>();

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "_");
}

export function makeProviderKey(
  tabId: number,
  provider: BridgeDiscoveryProvider,
  index: number
): string {
  if (provider.transport === "ws") {
    return `tab-${tabId}-ws-${encodeKeyPart(provider.endpoint ?? `provider-${index}`)}`;
  }
  return `tab-${tabId}-postmessage-${index}`;
}

export async function startBridgeClient(): Promise<void> {
  const prefs = await getPrefs();
  enabled = prefs.active && prefs.bridgeEnabled;
  if (enabled) tryConnect();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.prefs) {
      const newPrefs = changes.prefs.newValue;
      const shouldBeEnabled = (newPrefs?.active ?? true) && (newPrefs?.bridgeEnabled ?? false);
      if (shouldBeEnabled && !enabled) {
        enabled = true;
        tryConnect();
      } else if (!shouldBeEnabled && enabled) {
        enabled = false;
        stopBridge();
      }
    }
  });
}

export function stopBridge(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  console.log("Bridge: disabled");
}

function tryConnect(): void {
  if (ws || !enabled) return;

  try {
    ws = new WebSocket(BRIDGE_URL);

    ws.onopen = () => {
      connected = true;
      console.log("Bridge: connected to desktop app");

      for (const announcement of announcedProviders.values()) {
        send({
          type: "provider-available",
          tabId: announcement.tabId,
          providerKey: announcement.providerKey,
          provider: announcement.provider,
        });
      }

      queryAllTabsForSlop();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        bridgeMessageHandlers.forEach((handler) => handler(msg));
      } catch {}
    };

    ws.onclose = () => {
      connected = false;
      ws = null;
      scheduleRetry();
    };

    ws.onerror = () => {
      ws?.close();
    };
  } catch {
    ws = null;
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    tryConnect();
  }, RETRY_INTERVAL);
}

function send(message: any): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function announceProvider(announcement: ProviderAnnouncement): void {
  announcedProviders.set(announcement.providerKey, announcement);

  if (connected) {
    send({
      type: "provider-available",
      tabId: announcement.tabId,
      providerKey: announcement.providerKey,
      provider: announcement.provider,
    });
  }
}

export function announceProviderGone(tabId: number, providerKey: string): void {
  announcedProviders.delete(providerKey);

  if (connected) {
    send({ type: "provider-unavailable", tabId, providerKey });
  }
}

export function onBridgeMessage(handler: BridgeMessageHandler): void {
  bridgeMessageHandlers.push(handler);
}

export function relayToDesktop(providerKey: string, message: any): void {
  if (connected) {
    send({ type: "slop-relay", providerKey, message });
  }
}

async function queryAllTabsForSlop(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      if (tab.url.startsWith("chrome") || tab.url.startsWith("about")) continue;

      try {
        chrome.tabs.sendMessage(tab.id, { type: "get-slop-status" }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          if (!response.hasSlop || !response.providers?.length) return;

          response.providers.forEach((provider: BridgeDiscoveryProvider, index: number) => {
            const providerKey = makeProviderKey(tab.id!, provider, index);
            if (announcedProviders.has(providerKey)) return;

            announceProvider({
              tabId: tab.id!,
              providerKey,
              provider: {
                id: providerKey,
                name: response.providerName ?? tab.title ?? `Tab ${tab.id}`,
                transport: provider.transport,
                url: provider.endpoint,
              },
            });
          });
        });
      } catch {}
    }
  } catch {}
}
