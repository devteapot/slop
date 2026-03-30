import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SlopNode } from "@slop-ai/consumer/browser";
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer/browser";
import { UnixClientTransport } from "../slop/transport-unix";
import { BridgeClientTransport } from "../slop/transport-bridge";

export interface ProviderEntry {
  id: string;
  name: string;
  transportType: "ws" | "unix";
  url: string;        // WebSocket URL or Unix socket path
  status: "disconnected" | "connecting" | "connected";
  consumer: SlopConsumer | null;
  subscriptionId: string | null;
  currentTree: SlopNode | null;
  providerName: string | null;
  source: "manual" | "discovered" | "bridge";
  bridgeTabId?: number;
  bridgeTransport?: "ws" | "postmessage";  // original transport type from bridge
}

const MANUAL_PROVIDERS_KEY = "slopManualProviders";

function loadManualProviders(): { id: string; name: string; url: string; transportType: "ws" | "unix" }[] {
  try {
    const raw = localStorage.getItem(MANUAL_PROVIDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveManualProviders(providers: { id: string; name: string; url: string; transportType: "ws" | "unix" }[]) {
  localStorage.setItem(MANUAL_PROVIDERS_KEY, JSON.stringify(providers));
}

interface ProviderState {
  providers: Map<string, ProviderEntry>;
  activeProviderId: string | null;
  bridgeListening: boolean;

  getActiveProvider: () => ProviderEntry | null;
  loadDiscoveredProviders: () => Promise<void>;
  startBridgeListener: () => Promise<void>;
  addManualProvider: (url: string, name?: string) => string;
  removeProvider: (id: string) => void;
  connectProvider: (id: string) => Promise<void>;
  disconnectProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  updateTree: (id: string, tree: SlopNode) => void;
}

export const useProviderStore = create<ProviderState>((set, get) => {
  // Expose store on globalThis so workspace store can access without circular imports
  setTimeout(() => { (globalThis as any).__slopProviderStore = useProviderStore; }, 0);

  return ({
  providers: new Map(),
  activeProviderId: null,
  bridgeListening: false,

  getActiveProvider: () => {
    const { providers, activeProviderId } = get();
    return activeProviderId ? providers.get(activeProviderId) ?? null : null;
  },

  loadDiscoveredProviders: async () => {
    // Load from filesystem via Tauri
    try {
      const descriptors = await invoke<any[]>("list_providers");
      set(state => {
        const providers = new Map(state.providers);
        for (const desc of descriptors) {
          const id = `discovered-${desc.id ?? desc.name ?? Math.random().toString(36).slice(2)}`;
          if (providers.has(id)) continue;

          const transport = desc.transport; // singular — matches ProviderDescriptor format
          if (!transport) continue;

          if (transport.type === "ws" && transport.url) {
            providers.set(id, {
              id,
              name: desc.name ?? id,
              transportType: "ws",
              url: transport.url,
              status: "disconnected",
              consumer: null,
              subscriptionId: null,
              currentTree: null,
              providerName: null,
              source: "discovered",
            });
          } else if (transport.type === "unix" && transport.path) {
            providers.set(id, {
              id,
              name: desc.name ?? id,
              transportType: "unix",
              url: transport.path,
              status: "disconnected",
              consumer: null,
              subscriptionId: null,
              currentTree: null,
              providerName: null,
              source: "discovered",
            });
          }
        }
        return { providers };
      });
    } catch (err) {
      console.error("Failed to discover providers:", err);
    }

    // Load saved manual providers
    const manual = loadManualProviders();
    set(state => {
      const providers = new Map(state.providers);
      for (const m of manual) {
        if (!providers.has(m.id)) {
          providers.set(m.id, {
            id: m.id,
            name: m.name,
            transportType: m.transportType ?? "ws",
            url: m.url,
            status: "disconnected",
            consumer: null,
            subscriptionId: null,
            currentTree: null,
            providerName: null,
            source: "manual",
          });
        }
      }
      return { providers };
    });
  },

  startBridgeListener: async () => {
    if (get().bridgeListening) return;
    set({ bridgeListening: true });

    await listen<any>("bridge-message", (event) => {
      const msg = event.payload;
      if (!msg?.type) return;

      if (msg.type === "provider-available") {
        const { tabId, provider } = msg;
        const id = `bridge-${provider.id}`;

        set(state => {
          const providers = new Map(state.providers);
          // Don't overwrite if already connected
          if (providers.has(id) && providers.get(id)!.status === "connected") return state;

          providers.set(id, {
            id,
            name: provider.name ?? `Tab ${tabId}`,
            transportType: "ws",
            url: provider.transport === "ws" ? (provider.url ?? "") : "",
            status: "disconnected",
            consumer: null,
            subscriptionId: null,
            currentTree: null,
            providerName: null,
            source: "bridge",
            bridgeTabId: tabId,
            bridgeTransport: provider.transport,
          });
          return { providers };
        });
      }

      if (msg.type === "provider-unavailable") {
        const tabId = msg.tabId;
        set(state => {
          const providers = new Map(state.providers);
          let activeProviderId = state.activeProviderId;
          for (const [id, entry] of providers) {
            if (entry.source === "bridge" && entry.bridgeTabId === tabId) {
              // WS providers stay connected (direct WS, no bridge dependency)
              // PM providers lose their relay — disconnect them
              if (entry.bridgeTransport === "postmessage") {
                if (entry.consumer) entry.consumer.disconnect();
                providers.delete(id);
                if (activeProviderId === id) activeProviderId = null;
              }
              // WS providers: keep connected, they're direct
            }
          }
          return { providers, activeProviderId };
        });
      }
    });
  },

  addManualProvider: (url, name) => {
    const id = `manual-${Date.now()}`;
    const transportType = url.startsWith("ws://") || url.startsWith("wss://") ? "ws" as const : "unix" as const;
    const entry: ProviderEntry = {
      id,
      name: name ?? url,
      transportType,
      url,
      status: "disconnected",
      consumer: null,
      subscriptionId: null,
      currentTree: null,
      providerName: null,
      source: "manual",
    };
    set(state => {
      const providers = new Map(state.providers);
      providers.set(id, entry);
      const manual = loadManualProviders();
      manual.push({ id, name: entry.name, url, transportType });
      saveManualProviders(manual);
      return { providers };
    });
    return id;
  },

  removeProvider: (id) => {
    const { providers } = get();
    const entry = providers.get(id);
    if (entry?.consumer) entry.consumer.disconnect();
    set(state => {
      const providers = new Map(state.providers);
      providers.delete(id);
      const activeProviderId = state.activeProviderId === id ? null : state.activeProviderId;
      const manual = loadManualProviders().filter(m => m.id !== id);
      saveManualProviders(manual);
      return { providers, activeProviderId };
    });
  },

  connectProvider: async (id) => {
    const { providers } = get();
    const entry = providers.get(id);
    if (!entry) return;

    // Disconnect existing
    if (entry.consumer) entry.consumer.disconnect();

    set(state => {
      const providers = new Map(state.providers);
      providers.set(id, { ...providers.get(id)!, status: "connecting" as const });
      return { providers };
    });

    try {
      // Select transport: bridge PM uses BridgeClientTransport, WS/Unix connect directly
      const transport = entry.bridgeTabId != null && !entry.url
        ? new BridgeClientTransport(entry.bridgeTabId)
        : entry.transportType === "unix"
          ? new UnixClientTransport(entry.url)
          : new WebSocketClientTransport(entry.url);

      const consumer = new SlopConsumer(transport);
      const hello = await consumer.connect();
      const { id: subId, snapshot } = await consumer.subscribe("/", -1);

      set(state => {
        const providers = new Map(state.providers);
        providers.set(id, {
          ...providers.get(id)!,
          status: "connected",
          consumer,
          subscriptionId: subId,
          currentTree: snapshot,
          providerName: hello.provider.name,
        });
        return { providers, activeProviderId: id };
      });

      consumer.on("patch", () => {
        const { providers } = get();
        const current = providers.get(id);
        if (current?.subscriptionId) {
          const tree = consumer.getTree(current.subscriptionId);
          if (tree) get().updateTree(id, tree);
        }
      });

      consumer.on("disconnect", () => {
        const { providers } = get();
        const current = providers.get(id);
        const wasIntentional = current?.status === "disconnected";
        set(state => {
          const providers = new Map(state.providers);
          const e = providers.get(id);
          if (e) {
            providers.set(id, { ...e, status: "disconnected", consumer: null, subscriptionId: null });
          }
          return { providers };
        });
        if (!wasIntentional) {
          setTimeout(() => {
            const { providers } = get();
            if (providers.has(id) && providers.get(id)?.status === "disconnected") {
              get().connectProvider(id);
            }
          }, 2000);
        }
      });
    } catch (err: any) {
      set(state => {
        const providers = new Map(state.providers);
        const e = providers.get(id);
        if (e) {
          providers.set(id, { ...e, status: "disconnected", consumer: null });
        }
        return { providers };
      });
      throw err;
    }
  },

  disconnectProvider: (id) => {
    // Set status BEFORE disconnecting so the event handler knows it was intentional
    set(state => {
      const providers = new Map(state.providers);
      const e = providers.get(id);
      if (e) {
        providers.set(id, { ...e, status: "disconnected" });
      }
      return { providers };
    });
    const { providers } = get();
    const entry = providers.get(id);
    if (entry?.consumer) {
      entry.consumer.disconnect();
    }
    set(state => {
      const providers = new Map(state.providers);
      const e = providers.get(id);
      if (e) {
        providers.set(id, { ...e, status: "disconnected", consumer: null, subscriptionId: null });
      }
      return { providers };
    });
  },

  setActiveProvider: (id) => {
    set({ activeProviderId: id });
  },

  updateTree: (id, tree) => {
    set(state => {
      const providers = new Map(state.providers);
      const e = providers.get(id);
      if (e) {
        providers.set(id, { ...e, currentTree: tree });
      }
      return { providers };
    });
  },
})});
