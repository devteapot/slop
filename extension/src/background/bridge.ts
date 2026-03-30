/**
 * Bridge client — connects to the desktop app's local WebSocket bridge
 * at ws://localhost:9339/slop-bridge.
 *
 * Announces discovered browser providers so the desktop can see them.
 * Relays SLOP messages for SPA providers.
 */

import { getPrefs } from "../shared/messages";

const BRIDGE_URL = "ws://127.0.0.1:9339/slop-bridge";
const RETRY_INTERVAL = 5000; // 5 seconds — fast enough to catch desktop app startup

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;
let enabled = true;

interface ProviderAnnouncement {
  tabId: number;
  provider: {
    id: string;
    name: string;
    transport: "ws" | "postmessage";
    url?: string;
  };
}

// Track announced providers so we can re-announce on reconnect
const announcedProviders = new Map<number, ProviderAnnouncement>();

export async function startBridgeClient(): Promise<void> {
  const prefs = await getPrefs();
  enabled = prefs.active && prefs.bridgeEnabled;
  if (enabled) tryConnect();

  // Listen for pref changes (both master toggle and bridge toggle)
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
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (ws) { ws.close(); ws = null; }
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

      // Re-announce from in-memory map (survives if service worker stayed alive)
      for (const announcement of announcedProviders.values()) {
        send({ type: "provider-available", ...announcement });
      }

      // Also actively query all tabs for SLOP status
      // (handles MV3 service worker restart where announcedProviders is empty)
      queryAllTabsForSlop();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleBridgeMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      connected = false;
      ws = null;
      scheduleRetry();
    };

    ws.onerror = () => {
      // onclose will fire after this
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

// --- Public API ---

/** Announce a provider discovered on a browser tab */
export function announceProvider(
  tabId: number,
  provider: { id: string; name: string; transport: "ws" | "postmessage"; url?: string }
): void {
  const announcement: ProviderAnnouncement = { tabId, provider };
  announcedProviders.set(tabId, announcement);

  if (connected) {
    send({ type: "provider-available", ...announcement });
  }
}

/** Announce a provider is no longer available */
export function announceProviderGone(tabId: number): void {
  announcedProviders.delete(tabId);

  if (connected) {
    send({ type: "provider-unavailable", tabId });
  }
}

/** Send a SLOP relay message to the extension (from desktop via bridge) */
function handleBridgeMessage(msg: any): void {
  if (msg.type === "slop-relay" && msg.tabId) {
    // Desktop wants to send a SLOP message to a tab's provider
    // Route it through the appropriate port
    bridgeRelayHandlers.forEach(handler => handler(msg.tabId, msg.message));
  }
}

// Handlers for relay messages from desktop
const bridgeRelayHandlers: ((tabId: number, message: any) => void)[] = [];

/** Register a handler for relay messages from the desktop */
export function onBridgeRelay(handler: (tabId: number, message: any) => void): void {
  bridgeRelayHandlers.push(handler);
}

/**
 * Query all open tabs for their SLOP status.
 * Handles MV3 service worker restart: announcedProviders is empty
 * but tabs still have SLOP providers. Re-populates the map.
 */
async function queryAllTabsForSlop(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      // Skip chrome:// and extension pages
      if (tab.url.startsWith("chrome") || tab.url.startsWith("about")) continue;

      try {
        chrome.tabs.sendMessage(tab.id, { type: "get-slop-status" }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          if (response.hasSlop && response.transport) {
            const tabId = tab.id!;
            // Only announce if not already in the map
            if (!announcedProviders.has(tabId)) {
              announceProvider(tabId, {
                id: `tab-${tabId}`,
                name: response.providerName ?? tab.title ?? `Tab ${tabId}`,
                transport: response.transport,
                url: response.endpoint,
              });
            }
          }
        });
      } catch {
        // Tab might not have content script loaded
      }
    }
  } catch {
    // Query failed
  }
}

/** Relay a SLOP message from a tab back to the desktop */
export function relayToDesktop(tabId: number, message: any): void {
  if (connected) {
    send({ type: "slop-relay", tabId, message });
  }
}
