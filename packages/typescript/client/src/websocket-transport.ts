import type { Transport } from "@slop-ai/core";

const DEFAULT_DESKTOP_URL = "ws://localhost:9339/slop";

/**
 * Experimental WebSocket transport for exposing a browser SLOP provider over
 * an outbound WebSocket connection to an external consumer or app server.
 *
 * The SPA acts as the SLOP **provider** on this connection — it sends `hello`,
 * responds to `subscribe`, and pushes `snapshot`/`patch` messages.  The remote
 * end sends `connect`, `subscribe`, `query`, and `invoke`.
 *
 * Auto-reconnects with exponential backoff. This is useful for server-mounted
 * browser UI trees in fullstack apps, or as an optional extra path for
 * advanced integrations. Browser-only desktop discovery still typically uses
 * the extension relay.
 */
export function createWebSocketTransport(
  url: string = DEFAULT_DESKTOP_URL,
  options: { discover?: boolean } = {}
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
    } catch (e) {
      console.warn("[slop] WebSocket connection failed:", e);
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
      } catch (e) {
        console.warn("[slop] failed to parse WebSocket message:", e);
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

      // Inject meta tag for discovery when enabled.
      if (options.discover !== false && typeof document !== "undefined") {
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
