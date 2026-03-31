import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SlopNode } from "@slop-ai/consumer/browser";

export interface ProviderEntry {
  id: string;
  name: string;
  transportType: "ws" | "unix" | "relay";
  url: string;
  status: "disconnected" | "connecting" | "connected";
  currentTree: SlopNode | null;
  providerName: string | null;
  source: "manual" | "discovered" | "bridge";
  bridgeTabId?: number;
  bridgeProviderKey?: string;
  bridgeTransport?: "ws" | "postmessage";
}

interface ProviderConnectResult {
  providerName: string;
  tree: SlopNode;
}

export interface ProviderInvokeResult {
  status: "ok" | "error" | "accepted";
  data?: unknown;
  error?: { code: string; message: string };
}

interface ProviderEventPayload {
  providerId: string;
  kind: "tree" | "disconnected" | "error";
  providerName?: string;
  tree?: SlopNode;
  message?: string;
}

interface BridgeAvailableMessage {
  type: "provider-available";
  tabId: number;
  providerKey: string;
  provider: {
    id: string;
    name: string;
    transport: "ws" | "postmessage";
    url?: string;
  };
}

interface BridgeUnavailableMessage {
  type: "provider-unavailable";
  tabId: number;
  providerKey: string;
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

function toTransportConfig(entry: ProviderEntry) {
  if (entry.bridgeTransport === "postmessage" && entry.bridgeProviderKey) {
    return { type: "relay" as const, provider_key: entry.bridgeProviderKey };
  }

  if (entry.transportType === "unix") {
    return { type: "unix" as const, path: entry.url };
  }

  return { type: "ws" as const, url: entry.url };
}

function scheduleReconnect(id: string, delayMs = 2000) {
  setTimeout(() => {
    const store = useProviderStore.getState();
    const entry = store.providers.get(id);
    if (!entry || entry.status !== "disconnected") return;
    store.connectProvider(id).catch(() => {});
  }, delayMs);
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
  invokeProvider: (
    id: string,
    path: string,
    action: string,
    params?: Record<string, unknown>
  ) => Promise<ProviderInvokeResult>;
  setActiveProvider: (id: string) => void;
  updateTree: (id: string, tree: SlopNode, providerName?: string | null) => void;
}

export const useProviderStore = create<ProviderState>((set, get) => {
  setTimeout(() => {
    (globalThis as any).__slopProviderStore = useProviderStore;
  }, 0);

  return {
    providers: new Map(),
    activeProviderId: null,
    bridgeListening: false,

    getActiveProvider: () => {
      const { providers, activeProviderId } = get();
      return activeProviderId ? providers.get(activeProviderId) ?? null : null;
    },

    loadDiscoveredProviders: async () => {
      try {
        const descriptors = await invoke<any[]>("list_providers");
        set((state) => {
          const providers = new Map(state.providers);
          for (const desc of descriptors) {
            const id = `discovered-${desc.id ?? desc.name ?? Math.random().toString(36).slice(2)}`;
            const transport = desc.transport;
            if (!transport) continue;

            if (transport.type === "ws" && transport.url) {
              providers.set(id, {
                id,
                name: desc.name ?? id,
                transportType: "ws",
                url: transport.url,
                status: providers.get(id)?.status ?? "disconnected",
                currentTree: providers.get(id)?.currentTree ?? null,
                providerName: providers.get(id)?.providerName ?? null,
                source: "discovered",
              });
            } else if (transport.type === "unix" && transport.path) {
              providers.set(id, {
                id,
                name: desc.name ?? id,
                transportType: "unix",
                url: transport.path,
                status: providers.get(id)?.status ?? "disconnected",
                currentTree: providers.get(id)?.currentTree ?? null,
                providerName: providers.get(id)?.providerName ?? null,
                source: "discovered",
              });
            }
          }
          return { providers };
        });
      } catch (err) {
        console.error("Failed to discover providers:", err);
      }

      const manual = loadManualProviders();
      set((state) => {
        const providers = new Map(state.providers);
        for (const entry of manual) {
          if (providers.has(entry.id)) continue;
          providers.set(entry.id, {
            id: entry.id,
            name: entry.name,
            transportType: entry.transportType,
            url: entry.url,
            status: "disconnected",
            currentTree: null,
            providerName: null,
            source: "manual",
          });
        }
        return { providers };
      });
    },

    startBridgeListener: async () => {
      if (get().bridgeListening) return;
      set({ bridgeListening: true });

      await listen<BridgeAvailableMessage | BridgeUnavailableMessage>("bridge-message", (event) => {
        const msg = event.payload;
        if (!msg?.type) return;

        if (msg.type === "provider-available") {
          const id = `bridge-${msg.providerKey}`;
          set((state) => {
            const providers = new Map(state.providers);
            const existing = providers.get(id);
            providers.set(id, {
              id,
              name: msg.provider.name ?? `Tab ${msg.tabId}`,
              transportType: msg.provider.transport === "ws" ? "ws" : "relay",
              url: msg.provider.transport === "ws" ? (msg.provider.url ?? "") : "",
              status: existing?.status ?? "disconnected",
              currentTree: existing?.currentTree ?? null,
              providerName: existing?.providerName ?? null,
              source: "bridge",
              bridgeTabId: msg.tabId,
              bridgeProviderKey: msg.providerKey,
              bridgeTransport: msg.provider.transport,
            });
            return { providers };
          });
        }

        if (msg.type === "provider-unavailable") {
          const id = `bridge-${msg.providerKey}`;
          set((state) => {
            const providers = new Map(state.providers);
            const entry = providers.get(id);
            let activeProviderId = state.activeProviderId;

            if (entry?.bridgeTransport === "postmessage") {
              providers.delete(id);
              if (activeProviderId === id) activeProviderId = null;
            }

            return { providers, activeProviderId };
          });
        }
      });

      await listen<ProviderEventPayload>("provider-event", (event) => {
        const payload = event.payload;
        if (!payload?.providerId) return;

        if (payload.kind === "tree" && payload.tree) {
          get().updateTree(payload.providerId, payload.tree, payload.providerName ?? null);
          return;
        }

        if (payload.kind === "error" && payload.message) {
          console.error(`Provider ${payload.providerId}: ${payload.message}`);
          return;
        }

        if (payload.kind === "disconnected") {
          const current = get().providers.get(payload.providerId);
          const wasIntentional = current?.status === "disconnected";

          set((state) => {
            const providers = new Map(state.providers);
            const entry = providers.get(payload.providerId);
            if (!entry) return state;
            providers.set(payload.providerId, {
              ...entry,
              status: "disconnected",
              currentTree: entry.source === "bridge" && entry.bridgeTransport === "postmessage"
                ? null
                : entry.currentTree,
            });
            return { providers };
          });

          if (!wasIntentional) {
            scheduleReconnect(payload.providerId);
          }
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
        currentTree: null,
        providerName: null,
        source: "manual",
      };

      set((state) => {
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
      const entry = get().providers.get(id);
      if (entry?.status === "connected" || entry?.status === "connecting") {
        invoke("provider_disconnect", { providerId: id }).catch(() => {});
      }

      set((state) => {
        const providers = new Map(state.providers);
        providers.delete(id);
        const activeProviderId = state.activeProviderId === id ? null : state.activeProviderId;
        const manual = loadManualProviders().filter((provider) => provider.id !== id);
        saveManualProviders(manual);
        return { providers, activeProviderId };
      });
    },

    connectProvider: async (id) => {
      const entry = get().providers.get(id);
      if (!entry) return;

      set((state) => {
        const providers = new Map(state.providers);
        const current = providers.get(id);
        if (!current) return state;
        providers.set(id, { ...current, status: "connecting" });
        return { providers };
      });

      try {
        const result = await invoke<ProviderConnectResult>("provider_connect", {
          providerId: id,
          transport: toTransportConfig(entry),
        });

        set((state) => {
          const providers = new Map(state.providers);
          const current = providers.get(id);
          if (!current) return state;
          providers.set(id, {
            ...current,
            status: "connected",
            providerName: result.providerName,
            currentTree: result.tree,
          });
          return { providers, activeProviderId: id };
        });
      } catch (err) {
        set((state) => {
          const providers = new Map(state.providers);
          const current = providers.get(id);
          if (!current) return state;
          providers.set(id, { ...current, status: "disconnected" });
          return { providers };
        });
        throw err;
      }
    },

    disconnectProvider: (id) => {
      set((state) => {
        const providers = new Map(state.providers);
        const current = providers.get(id);
        if (!current) return state;
        providers.set(id, {
          ...current,
          status: "disconnected",
          currentTree: current.source === "bridge" && current.bridgeTransport === "postmessage"
            ? null
            : current.currentTree,
        });
        return { providers };
      });

      invoke("provider_disconnect", { providerId: id }).catch(() => {});
    },

    invokeProvider: async (id, path, action, params) => {
      return invoke<ProviderInvokeResult>("provider_invoke", {
        providerId: id,
        path,
        action,
        params,
      });
    },

    setActiveProvider: (id) => {
      set({ activeProviderId: id });
    },

    updateTree: (id, tree, providerName) => {
      set((state) => {
        const providers = new Map(state.providers);
        const current = providers.get(id);
        if (!current) return state;
        providers.set(id, {
          ...current,
          currentTree: tree,
          status: "connected",
          providerName: providerName ?? current.providerName,
        });
        return { providers };
      });
    },
  };
});
