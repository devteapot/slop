/**
 * Desktop bridge client — connects to ws://localhost:9339/slop-bridge.
 * Announces providers and relays postMessage traffic for SPAs.
 */

import { getPrefs } from "../types";

const BRIDGE_URL = "ws://127.0.0.1:9339/slop-bridge";
const RETRY_INTERVAL = 5000;

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;
let enabled = true;

type MessageHandler = (msg: any) => void;
type ConnectHandler = () => void;

const messageHandlers: MessageHandler[] = [];
const connectHandlers: ConnectHandler[] = [];

function send(message: any): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function tryConnect(): void {
  if (ws || !enabled) return;

  try {
    ws = new WebSocket(BRIDGE_URL);

    ws.onopen = () => {
      connected = true;
      console.log("Bridge: connected to desktop app");
      for (const handler of connectHandlers) handler();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        for (const handler of messageHandlers) handler(msg);
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
  if (retryTimer || !enabled) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    tryConnect();
  }, RETRY_INTERVAL);
}

function stop(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
}

// --- Public API ---

export async function start(): Promise<void> {
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
        stop();
      }
    }
  });
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

export function announceProvider(announcement: ProviderAnnouncement): void {
  if (connected) {
    send({
      type: "provider-available",
      tabId: announcement.tabId,
      providerKey: announcement.providerKey,
      provider: announcement.provider,
    });
  }
}

export function announceGone(tabId: number, providerKey: string): void {
  if (connected) {
    send({ type: "provider-unavailable", tabId, providerKey });
  }
}

export function relayToDesktop(providerKey: string, message: any): void {
  if (connected) {
    send({ type: "slop-relay", providerKey, message });
  }
}

export function onMessage(handler: MessageHandler): void {
  messageHandlers.push(handler);
}

export function onConnect(handler: ConnectHandler): void {
  connectHandlers.push(handler);
}
