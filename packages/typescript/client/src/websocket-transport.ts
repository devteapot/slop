import type { Transport } from "@slop-ai/core";

const DEFAULT_DESKTOP_URL = "ws://localhost:9339/slop";

/**
 * WebSocket transport for connecting a browser SLOP provider directly to a
 * desktop consumer (or any WebSocket-based consumer).
 *
 * The SPA acts as the SLOP **provider** on this connection — it sends `hello`,
 * responds to `subscribe`, and pushes `snapshot`/`patch` messages.  The remote
 * end sends `connect`, `subscribe`, `query`, and `invoke`.
 *
 * Auto-reconnects with exponential backoff.  Falls back gracefully when the
 * desktop is not running (postMessage transport still works for the extension).
 */
export function createWebSocketTransport(
  url: string = DEFAULT_DESKTOP_URL
): Transport {
  const messageHandlers: ((msg: any) => void)[] = [];
  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let metaTag: HTMLMetaElement | null = null;

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      reconnectDelay = 1000; // reset on successful connect
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type) {
          for (const h of messageHandlers) h(msg);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }

  return {
    send(message: unknown) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
      // silently drop if not connected — provider will re-send hello on reconnect
    },

    onMessage(handler: (msg: any) => void) {
      messageHandlers.push(handler);
    },

    start() {
      stopped = false;
      connect();

      // Inject meta tag for discovery (extension can announce the WS endpoint)
      if (typeof document !== "undefined") {
        const selector = `meta[name="slop"][content="${url}"]`;
        if (!document.querySelector(selector)) {
          metaTag = document.createElement("meta");
          metaTag.name = "slop";
          metaTag.content = url;
          document.head.appendChild(metaTag);
        }
      }
    },

    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null; // prevent reconnect
        ws.close();
        ws = null;
      }
      if (metaTag) {
        metaTag.remove();
        metaTag = null;
      }
    },
  };
}
