import WebSocket, { WebSocketServer } from "ws";
import type { Bridge, BridgeProvider, RelayHandler } from "./bridge-client";
import { parseBridgeProvider } from "./bridge-client";

export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 9339;
export const DEFAULT_BRIDGE_PATH = "/slop-bridge";

type Logger = { info: (...args: any[]) => void; error: (...args: any[]) => void };

export interface BridgeServerOptions {
  logger?: Logger;
  host?: string;
  port?: number;
  path?: string;
}

/**
 * Bridge WebSocket server — hosts the extension bridge at ws://127.0.0.1:9339/slop-bridge.
 *
 * Mirrors the Go bridge server in apps/cli/bridge/server.go.
 * Accepts connections from the browser extension and other consumers,
 * tracks provider announcements, and relays SLOP messages for postMessage providers.
 */
export function createBridgeServer(
  optionsOrLogger?: BridgeServerOptions | Logger,
): Bridge & { start(): Promise<void> } {
  const {
    logger: log,
    host,
    port,
    path,
  } = normalizeOptions(optionsOrLogger);

  let wss: WebSocketServer | null = null;
  let isRunning = false;
  let changeCallback: (() => void) | null = null;

  const sinks = new Set<WebSocket>();
  const providerMap = new Map<string, BridgeProvider>();
  const relaySubscribers = new Map<string, RelayHandler[]>();

  // --- Broadcasting ---

  function broadcast(msg: Record<string, unknown>) {
    const text = JSON.stringify(msg);
    for (const sink of sinks) {
      if (sink.readyState === WebSocket.OPEN) {
        sink.send(text);
      }
    }
  }

  function replayProviders(ws: WebSocket) {
    for (const bp of providerMap.values()) {
      const msg = {
        type: "provider-available",
        tabId: bp.tabId,
        providerKey: bp.providerKey,
        provider: {
          id: bp.id,
          name: bp.name,
          transport: bp.transport,
          ...(bp.url ? { url: bp.url } : {}),
        },
      };
      ws.send(JSON.stringify(msg));
    }
  }

  // --- Message handling ---

  function handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    switch (type) {
      case "provider-available": {
        const bp = parseBridgeProvider(msg);
        if (!bp) return;
        providerMap.set(bp.providerKey, bp);
        log.info(`[slop-bridge] Provider available: ${bp.name} (${bp.providerKey})`);
        broadcast(msg);
        changeCallback?.();
        break;
      }

      case "provider-unavailable": {
        const providerKey = msg.providerKey as string;
        if (!providerKey) return;
        providerMap.delete(providerKey);
        relaySubscribers.delete(providerKey);
        log.info(`[slop-bridge] Provider unavailable: ${providerKey}`);
        broadcast(msg);
        changeCallback?.();
        break;
      }

      case "slop-relay": {
        const providerKey = msg.providerKey as string;
        const message = msg.message as Record<string, unknown>;
        if (!providerKey || !message) return;
        // Dispatch to local relay subscribers
        const subs = relaySubscribers.get(providerKey);
        if (subs) {
          for (const handler of subs) handler(message);
        }
        // Rebroadcast to all sinks (extension receives consumer messages,
        // consumers receive extension responses)
        broadcast(msg);
        break;
      }

      case "relay-open":
      case "relay-close": {
        // Forward to all sinks so the extension receives relay control
        broadcast(msg);
        break;
      }
    }
  }

  return {
    /** Bind to port 9339. Resolves when listening, rejects if port is in use. */
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        wss = new WebSocketServer({
          host,
          port,
          path,
        });

        wss.on("listening", () => {
          isRunning = true;
          log.info(`[slop-bridge] Bridge server running on ws://${host}:${port}${path}`);
          resolve();
        });

        wss.on("error", (err: Error) => {
          if (!isRunning) {
            reject(err);
          } else {
            log.error("[slop-bridge] Server error:", err.message);
          }
        });

        wss.on("connection", (ws: WebSocket) => {
          sinks.add(ws);
          log.info(`[slop-bridge] Client connected (${sinks.size} total)`);

          // Replay current providers to new connection
          replayProviders(ws);

          ws.on("message", (data: WebSocket.Data) => {
            try {
              const msg = JSON.parse(data.toString());
              handleMessage(msg);
            } catch {}
          });

          ws.on("close", () => {
            sinks.delete(ws);
            log.info(`[slop-bridge] Client disconnected (${sinks.size} remaining)`);

            if (sinks.size === 0) {
              // No clients left — clear all relay subscribers and providers
              relaySubscribers.clear();
              providerMap.clear();
              changeCallback?.();
            }
          });
        });
      });
    },

    running() {
      return isRunning;
    },

    providers() {
      return Array.from(providerMap.values());
    },

    onProviderChange(fn: () => void) {
      changeCallback = fn;
    },

    subscribeRelay(providerKey: string): RelayHandler[] {
      const handlers = relaySubscribers.get(providerKey) ?? [];
      relaySubscribers.set(providerKey, handlers);
      return handlers;
    },

    unsubscribeRelay(providerKey: string, handler: RelayHandler) {
      const subs = relaySubscribers.get(providerKey);
      if (!subs) return;
      const idx = subs.indexOf(handler);
      if (idx >= 0) subs.splice(idx, 1);
      if (subs.length === 0) relaySubscribers.delete(providerKey);
    },

    send(msg: Record<string, unknown>) {
      broadcast(msg);
    },

    stop() {
      isRunning = false;
      for (const sink of sinks) sink.close();
      sinks.clear();
      providerMap.clear();
      relaySubscribers.clear();
      if (wss) {
        wss.close();
        wss = null;
      }
    },
  };
}

function normalizeOptions(optionsOrLogger?: BridgeServerOptions | Logger): Required<BridgeServerOptions> {
  const options =
    optionsOrLogger && ("host" in optionsOrLogger || "port" in optionsOrLogger || "path" in optionsOrLogger || "logger" in optionsOrLogger)
      ? optionsOrLogger as BridgeServerOptions
      : { logger: optionsOrLogger as Logger | undefined };

  return {
    logger: options.logger ?? { info: console.error, error: console.error },
    host: options.host ?? DEFAULT_BRIDGE_HOST,
    port: options.port ?? DEFAULT_BRIDGE_PORT,
    path: options.path ?? DEFAULT_BRIDGE_PATH,
  };
}
