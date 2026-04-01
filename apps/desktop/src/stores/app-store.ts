import { create } from "zustand";
import type {
  WorkspaceSummary,
  ProviderSummary,
  LlmProfile,
  SlopNode,
} from "../lib/types";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as commands from "../lib/commands";
import { setupEvents, cleanup } from "../lib/events";

interface AppState {
  // Workspaces
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;

  // Providers
  providers: ProviderSummary[];
  providerTrees: Record<string, SlopNode>;

  // LLM
  profiles: LlmProfile[];
  activeProfileId: string;
  models: string[];
  modelsLoading: boolean;

  // Bridge
  bridgeConnected: boolean;

  // Initialization
  initialized: boolean;
  init: () => Promise<void>;
  destroy: () => void;

  // Workspace actions
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  setActiveWorkspace: (id: string) => Promise<void>;

  // Provider actions
  connectProvider: (providerId: string) => Promise<void>;
  disconnectProvider: (providerId: string) => Promise<void>;
  addManualProvider: (url: string, name?: string) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;

  // LLM actions
  setActiveProfile: (id: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  fetchModels: () => Promise<void>;
  addProfile: (profile: LlmProfile) => Promise<void>;
  updateProfile: (id: string, updates: Partial<LlmProfile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: "",
  providers: [],
  providerTrees: {},
  profiles: [],
  activeProfileId: "",
  models: [],
  modelsLoading: false,
  bridgeConnected: false,
  initialized: false,

  init: async () => {
    const [workspaces, providers, profiles, activeProfile] = await Promise.all([
      commands.listWorkspaces(),
      commands.listProviders(),
      commands.listProfiles(),
      commands.getActiveProfile(),
    ]);

    set({
      workspaces,
      activeWorkspaceId: workspaces[0]?.id ?? "",
      providers,
      profiles,
      activeProfileId: activeProfile.id,
      initialized: true,
    });

    // Set up event listeners
    await setupEvents({
      onProviderDiscovered: (provider) => {
        set((state) => {
          const existing = state.providers.find((p) => p.id === provider.id);
          if (existing) return state;
          return { providers: [...state.providers, provider] };
        });
      },
      onProviderRemoved: ({ provider_id }) => {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== provider_id),
        }));
      },
      onProviderStatus: (payload) => {
        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === payload.provider_id
              ? {
                  ...p,
                  status: payload.status,
                  provider_name: payload.provider_name ?? p.provider_name,
                }
              : p
          );
          let providerTrees = state.providerTrees;
          if (payload.tree) {
            providerTrees = { ...providerTrees, [payload.provider_id]: payload.tree };
          } else if (payload.status === "disconnected") {
            const { [payload.provider_id]: _, ...rest } = providerTrees;
            providerTrees = rest;
          }
          return { providers, providerTrees };
        });
      },
      onWorkspacesChanged: ({ workspaces }) => {
        set({ workspaces });
      },
      onProfilesChanged: ({ profiles, active_id }) => {
        set({ profiles, activeProfileId: active_id });
      },
    });

    // Bridge status listener
    listen<boolean>("bridge-status", (e) => {
      set({ bridgeConnected: e.payload });
    });

    // Initial discovery refresh
    commands.refreshDiscovery().catch(() => {});
  },

  destroy: () => {
    cleanup();
  },

  createWorkspace: async (name) => {
    const ws = await commands.createWorkspace(name);
    // workspaces-changed event will update the list; just set active
    set({ activeWorkspaceId: ws.id });
  },

  renameWorkspace: async (id, name) => {
    await commands.renameWorkspace(id, name);
    // workspaces-changed event will update the list
  },

  deleteWorkspace: async (id) => {
    await commands.deleteWorkspace(id);
    // workspaces-changed event will update the list + active
    const state = get();
    if (state.activeWorkspaceId === id) {
      const remaining = state.workspaces.filter(w => w.id !== id);
      set({ activeWorkspaceId: remaining[0]?.id ?? "" });
    }
  },

  setActiveWorkspace: async (id) => {
    await commands.setActiveWorkspace(id);
    set({ activeWorkspaceId: id });
  },

  connectProvider: async (providerId) => {
    const { activeWorkspaceId } = get();
    await commands.connectProvider(providerId, activeWorkspaceId);
  },

  disconnectProvider: async (providerId) => {
    const { activeWorkspaceId } = get();
    await commands.disconnectProvider(providerId, activeWorkspaceId);
  },

  addManualProvider: async (url, name) => {
    await commands.addManualProvider(url, name);
  },

  removeProvider: async (providerId) => {
    await commands.removeProvider(providerId);
  },

  setActiveProfile: async (id) => {
    await commands.setActiveProfile(id);
    // profiles-changed event will update activeProfileId
  },

  setModel: async (model) => {
    await commands.setModel(model);
  },

  fetchModels: async () => {
    set({ modelsLoading: true });
    try {
      const models = await commands.fetchModels();
      set({ models, modelsLoading: false });
    } catch {
      set({ modelsLoading: false });
    }
  },

  addProfile: async (profile) => {
    await commands.addProfile(profile);
  },

  updateProfile: async (id, updates) => {
    await commands.updateProfile(id, updates);
  },

  deleteProfile: async (id) => {
    await commands.deleteProfile(id);
  },
}));
