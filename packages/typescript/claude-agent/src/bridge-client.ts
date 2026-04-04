import WebSocket from "ws";

const BRIDGE_URL = "ws://127.0.0.1:9339/slop-bridge";
const RECONNECT_INTERVAL = 5000;

export interface BridgeProvider {
  providerKey: string;
  tabId: number;
  id: string;
  name: string;
  transport: "ws" | "postmessage";
  url?: string;
}

export type RelayHandler = (message: Record<string, unknown>) => void;

export interface BridgeClient {
  running(): boolean;
  providers(): BridgeProvider[];
  onProviderChange(fn: () => void): void;
  subscribeRelay(providerKey: string): RelayHandler[];
  unsubscribeRelay(providerKey: string, handler: RelayHandler): void;
  send(msg: Record<string, unknown>): void;
  start(): void;
  stop(): void;
}

export function createBridgeClient(
  logger?: { info: (...args: any[]) => void; error: (...args: any[]) => void },
): BridgeClient {
  const log = logger ?? { info: console.log, error: console.error };

  let ws: WebSocket | null = null;
  let isRunning = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let changeCallback: (() => void) | null = null;

  const providerMap = new Map<string, BridgeProvider>();
  const relaySubscribers = new Map<string, RelayHandler[]>();

  function connect() {
    if (ws) return;

    try {
      ws = new WebSocket(BRIDGE_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      isRunning = true;
      log.info("[slop-bridge] Connected to extension bridge");
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch {}
    });

    ws.on("close", () => {
      isRunning = false;
      ws = null;
      // Remove all bridge providers on disconnect
      if (providerMap.size > 0) {
        providerMap.clear();
        changeCallback?.();
      }
      scheduleReconnect();
    });

    ws.on("error", () => {
      // Error will trigger close, which handles reconnect
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_INTERVAL);
  }

  function handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    switch (type) {
      case "provider-available": {
        const providerKey = msg.providerKey as string;
        if (!providerKey) return;

        const provider = msg.provider as Record<string, unknown> | undefined;
        const bp: BridgeProvider = {
          providerKey,
          tabId: (msg.tabId as number) ?? 0,
          id: (provider?.id as string) ?? providerKey,
          name: (provider?.name as string) ?? `Tab`,
          transport: (provider?.transport as "ws" | "postmessage") ?? "postmessage",
          url: provider?.url as string | undefined,
        };

        providerMap.set(providerKey, bp);
        log.info(`[slop-bridge] Provider available: ${bp.name} (${bp.providerKey})`);
        changeCallback?.();
        break;
      }

      case "provider-unavailable": {
        const providerKey = msg.providerKey as string;
        if (!providerKey) return;

        providerMap.delete(providerKey);

        // Close relay channels for this provider
        const subs = relaySubscribers.get(providerKey);
        if (subs) {
          relaySubscribers.delete(providerKey);
        }

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
          for (const handler of subs) {
            handler(message);
          }
        }
        break;
      }
    }
  }

  return {
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
      connect();
    },

    stop() {
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
