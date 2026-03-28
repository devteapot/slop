import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { SlopNode } from "../slop/types";
import { SlopConsumer } from "../slop/consumer";
import { WebSocketClientTransport } from "../slop/transport-ws";

export interface ProviderEntry {
  id: string;
  name: string;
  url: string;
  status: "disconnected" | "connecting" | "connected";
  consumer: SlopConsumer | null;
  subscriptionId: string | null;
  currentTree: SlopNode | null;
  providerName: string | null;
  source: "manual" | "discovered";
}

const MANUAL_PROVIDERS_KEY = "slopManualProviders";

function loadManualProviders(): { id: string; name: string; url: string }[] {
  try {
    const raw = localStorage.getItem(MANUAL_PROVIDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveManualProviders(providers: { id: string; name: string; url: string }[]) {
  localStorage.setItem(MANUAL_PROVIDERS_KEY, JSON.stringify(providers));
}

interface ProviderState {
  providers: Map<string, ProviderEntry>;
  activeProviderId: string | null;

  getActiveProvider: () => ProviderEntry | null;
  loadDiscoveredProviders: () => Promise<void>;
  addManualProvider: (url: string, name?: string) => string;
  removeProvider: (id: string) => void;
  connectProvider: (id: string) => Promise<void>;
  disconnectProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  updateTree: (id: string, tree: SlopNode) => void;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: new Map(),
  activeProviderId: null,

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
          if (!providers.has(id)) {
            const transport = desc.transports?.[0];
            const url = transport?.url ?? transport?.endpoint ?? "";
            if (url && (url.startsWith("ws://") || url.startsWith("wss://"))) {
              providers.set(id, {
                id,
                name: desc.name ?? id,
                url,
                status: "disconnected",
                consumer: null,
                subscriptionId: null,
                currentTree: null,
                providerName: null,
                source: "discovered",
              });
            }
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

  addManualProvider: (url, name) => {
    const id = `manual-${Date.now()}`;
    const entry: ProviderEntry = {
      id,
      name: name ?? url,
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
      // Persist manual providers
      const manual = loadManualProviders();
      manual.push({ id, name: entry.name, url });
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
      // Update persisted manual providers
      const manual = loadManualProviders().filter(m => m.id !== id);
      saveManualProviders(manual);
      return { providers, activeProviderId };
    });
  },

  connectProvider: async (id) => {
    const { providers } = get();
    const entry = providers.get(id);
    if (!entry) return;

    // Disconnect existing connection
    if (entry.consumer) {
      entry.consumer.disconnect();
    }

    set(state => {
      const providers = new Map(state.providers);
      const e = { ...providers.get(id)!, status: "connecting" as const };
      providers.set(id, e);
      return { providers };
    });

    try {
      const transport = new WebSocketClientTransport(entry.url);
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
        set(state => {
          const providers = new Map(state.providers);
          const e = providers.get(id);
          if (e) {
            providers.set(id, { ...e, status: "disconnected", consumer: null, subscriptionId: null });
          }
          return { providers };
        });
        // Auto-reconnect after 2 seconds
        setTimeout(() => {
          const { providers } = get();
          if (providers.has(id)) {
            get().connectProvider(id);
          }
        }, 2000);
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
}));
