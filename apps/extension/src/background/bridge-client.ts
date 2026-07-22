/**
 * Desktop bridge client — connects to ws://localhost:9339/slop-bridge.
 * Announces providers and relays postMessage traffic for SPAs.
 *
 * The bridge requires a pairing token (spec/integrations/desktop.md § Bridge
 * security). The token travels in the WebSocket subprotocol list
 * (["slop.bearer", token]); the server echoes back only the label on success
 * and rejects the upgrade otherwise. The token is never logged.
 */

import {
  BRIDGE_TOKEN_STORAGE_KEY,
  buildBridgeProtocols,
  getBridgeToken,
  isAcceptedBridgeProtocol,
} from "../lib/bridge-auth";
import type {
  BridgeMessageFromDesktop,
  BridgeMessageToDesktop,
  BridgeStatus,
  ExtensionPrefs,
  ProviderRelayMessage,
} from "../types";
import { getPrefs } from "../types";

const BRIDGE_URL = "ws://127.0.0.1:9339/slop-bridge";
const BRIDGE_PROBE_URL = "http://127.0.0.1:9339/slop-bridge";
const RETRY_INTERVAL = 5000;

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;
let enabled = true;
let token: string | null = null;
let status: BridgeStatus = "disabled";

type MessageHandler = (msg: BridgeMessageFromDesktop) => void;
type ConnectHandler = () => void;

const messageHandlers: MessageHandler[] = [];
const connectHandlers: ConnectHandler[] = [];

function send(message: BridgeMessageToDesktop): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function setStatus(next: BridgeStatus): void {
  status = next;
}

function tryConnect(): void {
  if (ws || !enabled) return;

  if (!token) {
    // No pairing token: do not enter the retry loop. The popup surfaces a
    // "pair with desktop" state; a token change restarts the connection.
    setStatus("unpaired");
    return;
  }

  const connectToken = token;
  let opened = false;

  try {
    ws = new WebSocket(BRIDGE_URL, buildBridgeProtocols(connectToken));
    setStatus("connecting");

    ws.onopen = () => {
      if (!ws) return;
      if (!isAcceptedBridgeProtocol(ws.protocol)) {
        // Not a compliant bridge — do not treat as authenticated.
        console.warn("[slop] bridge accepted connection without the expected subprotocol; closing");
        ws.close();
        return;
      }
      opened = true;
      connected = true;
      setStatus("connected");
      console.log("Bridge: connected to desktop app");
      for (const handler of connectHandlers) handler();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (isBridgeMessageFromDesktop(msg)) {
          for (const handler of messageHandlers) handler(msg);
        }
      } catch (e) {
        console.warn("[slop] failed to parse desktop bridge message:", e);
      }
    };

    ws.onclose = () => {
      connected = false;
      ws = null;
      if (!enabled) return;
      if (opened) {
        // Was authenticated and the desktop went away — normal retry loop.
        setStatus("retrying");
        scheduleRetry();
      } else {
        // Closed before the upgrade completed: either the desktop is down
        // (keep retrying) or it rejected our token (surface re-pair instead
        // of hot-looping). Probe distinguishes the two.
        void classifyHandshakeFailure();
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  } catch (e) {
    console.warn("[slop] failed to connect to desktop bridge:", e);
    ws = null;
    setStatus("retrying");
    scheduleRetry();
  }
}

/**
 * The browser WebSocket API cannot distinguish "connection refused" from a
 * 401 upgrade rejection. Probe the bridge endpoint over plain HTTP: any
 * response means the server is up and our token was rejected.
 */
async function classifyHandshakeFailure(): Promise<void> {
  let serverReachable = false;
  try {
    await fetch(BRIDGE_PROBE_URL, { method: "GET", mode: "no-cors", cache: "no-store" });
    serverReachable = true;
  } catch {
    serverReachable = false;
  }

  if (!enabled || ws) return;

  if (serverReachable) {
    // Desktop is running but rejected the upgrade — bad/stale token.
    // Stop retrying; the popup surfaces a re-pair prompt. A token change
    // or toggling the bridge restarts the loop.
    setStatus("auth-failed");
    console.warn("[slop] desktop bridge rejected pairing token; re-pair from the desktop app");
    return;
  }

  setStatus("retrying");
  scheduleRetry();
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

function restart(): void {
  stop();
  if (enabled) {
    tryConnect();
  } else {
    setStatus("disabled");
  }
}

// --- Public API ---

export async function start(): Promise<void> {
  const prefs = await getPrefs();
  enabled = prefs.active && prefs.bridgeEnabled;
  token = await getBridgeToken();
  if (enabled) {
    tryConnect();
  } else {
    setStatus("disabled");
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes[BRIDGE_TOKEN_STORAGE_KEY]) {
      const newValue = changes[BRIDGE_TOKEN_STORAGE_KEY].newValue;
      token = typeof newValue === "string" && newValue.length > 0 ? newValue : null;
      restart();
      return;
    }

    if (changes.prefs) {
      const newPrefs = isExtensionPrefsPatch(changes.prefs.newValue) ? changes.prefs.newValue : undefined;
      const shouldBeEnabled = (newPrefs?.active ?? true) && (newPrefs?.bridgeEnabled ?? false);
      if (shouldBeEnabled && !enabled) {
        enabled = true;
        tryConnect();
      } else if (!shouldBeEnabled && enabled) {
        enabled = false;
        stop();
        setStatus("disabled");
      }
    }
  });
}

export function getStatus(): BridgeStatus {
  return status;
}

export interface ProviderAnnouncement {
  tabId: number;
  providerKey: string;
  provider: {
    id: string;
    name: string;
    providerId?: string;
    transport: "ws" | "postmessage";
    url?: string;
    tabTitle?: string;
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

export function relayToDesktop(providerKey: string, message: ProviderRelayMessage["message"]): void {
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

function isBridgeMessageFromDesktop(value: unknown): value is BridgeMessageFromDesktop {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  if (msg.type === "relay-open" || msg.type === "relay-close") {
    return typeof msg.providerKey === "string";
  }
  return msg.type === "slop-relay" && typeof msg.providerKey === "string" && !!msg.message;
}

function isExtensionPrefsPatch(value: unknown): value is Partial<ExtensionPrefs> {
  return !!value && typeof value === "object";
}
