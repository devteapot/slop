import WebSocket from "ws";

export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:9339/slop-bridge";
const DEFAULT_RECONNECT_INTERVAL = 5000;

type Logger = { info: (...args: any[]) => void; error: (...args: any[]) => void };

export interface BridgeClientOptions {
  logger?: Logger;
  url?: string;
  reconnectIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface BridgeProvider {
  providerKey: string;
  tabId: number;
  id: string;
  name: string;
  transport: "ws" | "postmessage";
  url?: string;
}

export type RelayHandler = (message: Record<string, unknown>) => void;

/** Common interface for both bridge client and bridge server. */
export interface Bridge {
  running(): boolean;
  providers(): BridgeProvider[];
  onProviderChange(fn: () => void): void;
  subscribeRelay(providerKey: string): RelayHandler[];
  unsubscribeRelay(providerKey: string, handler: RelayHandler): void;
  send(msg: Record<string, unknown>): void;
  start(): void;
  stop(): void;
}

// ---------------------------------------------------------------------------
// Shared message parsing
// ---------------------------------------------------------------------------

export function parseBridgeProvider(msg: Record<string, unknown>): BridgeProvider | null {
  const providerKey = msg.providerKey as string;
  if (!providerKey) return null;

  const provider = msg.provider as Record<string, unknown> | undefined;
  return {
    providerKey,
    tabId: (msg.tabId as number) ?? 0,
    id: (provider?.id as string) ?? providerKey,
    name: (provider?.name as string) ?? "Tab",
    transport: (provider?.transport as "ws" | "postmessage") ?? "postmessage",
    url: provider?.url as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Bridge Client
// ---------------------------------------------------------------------------

export function createBridgeClient(
  options: BridgeClientOptions = {},
): Bridge & { connectOnce(): Promise<void> } {
  const {
    logger: log,
    url,
    reconnectIntervalMs,
  } = normalizeOptions(options);

  let ws: WebSocket | null = null;
  let isRunning = false;
  let started = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectPromise: Promise<void> | null = null;
  let changeCallback: (() => void) | null = null;

  const providerMap = new Map<string, BridgeProvider>();
  const relaySubscribers = new Map<string, RelayHandler[]>();

  function doConnect(): Promise<void> {
    if (connectPromise) return connectPromise;
    if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();

    connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;

      try {
        socket = new WebSocket(url);
      } catch (error: any) {
        connectPromise = null;
        reject(error);
        return;
      }

      ws = socket;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        connectPromise = null;
        fn();
      };

      socket.on("open", () => {
        if (ws !== socket) {
          socket.close();
          settle(resolve);
          return;
        }
        isRunning = true;
        log.info("[slop-bridge] Connected to extension bridge");
        settle(resolve);
      });

      socket.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          handleMessage(msg);
        } catch {}
      });

      socket.on("close", () => {
        if (ws === socket) {
          isRunning = false;
          ws = null;
          if (providerMap.size > 0) {
            providerMap.clear();
            changeCallback?.();
          }
          if (started) {
            scheduleReconnect();
          }
        }
        settle(() => reject(new Error("Bridge connection closed")));
      });

      socket.on("error", (err: Error) => {
        settle(() => reject(err));
      });
    });

    return connectPromise;
  }

  function scheduleReconnect() {
    if (!started || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void doConnect().catch(() => {});
    }, reconnectIntervalMs);
  }

  function handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    switch (type) {
      case "provider-available": {
        const bp = parseBridgeProvider(msg);
        if (!bp) return;
        providerMap.set(bp.providerKey, bp);
        log.info(`[slop-bridge] Provider available: ${bp.name} (${bp.providerKey})`);
        changeCallback?.();
        break;
      }

      case "provider-unavailable": {
        const providerKey = msg.providerKey as string;
        if (!providerKey) return;
        providerMap.delete(providerKey);
        relaySubscribers.delete(providerKey);
        log.info(`[slop-bridge] Provider unavailable: ${providerKey}`);
        changeCallback?.();
        break;
      }

      case "slop-relay": {
        const providerKey = msg.providerKey as string;
        const message = msg.message as Record<string, unknown>;
        if (!providerKey || !message) return;
        const subs = relaySubscribers.get(providerKey);
        if (subs) {
          for (const handler of subs) handler(message);
        }
        break;
      }
    }
  }

  return {
    /** Single connection attempt — resolves on open, rejects on error. */
    connectOnce(): Promise<void> {
      return doConnect();
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
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },

    start() {
      started = true;
      void doConnect().catch(() => {});
    },

    stop() {
      started = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      isRunning = false;
      providerMap.clear();
      relaySubscribers.clear();
    },
  };
}

function normalizeOptions(options: BridgeClientOptions = {}): Required<BridgeClientOptions> {
  return {
    logger: options.logger ?? { info: console.error, error: console.error },
    url: options.url ?? DEFAULT_BRIDGE_URL,
    reconnectIntervalMs: options.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL,
  };
}
