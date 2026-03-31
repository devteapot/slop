import { create } from "zustand";
import type { UiMessage } from "./use-chat";

export interface PinnedProvider {
  id: string;
  name: string;
  url: string;
  transportType: "ws" | "unix" | "relay";
}

export interface Workspace {
  id: string;
  name: string;
  providerIds: string[];          // providers connected in this workspace
  pinnedProviders: PinnedProvider[]; // pinned providers for this workspace
  conversation: any[];
  messages: UiMessage[];
}

const STORAGE_KEY = "slop:workspaces";
const ACTIVE_KEY = "slop:activeWorkspace";

function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const workspaces = JSON.parse(raw) as Workspace[];
    // Migrate old workspaces missing pinnedProviders
    return workspaces.map(w => ({
      ...w,
      pinnedProviders: w.pinnedProviders ?? [],
    }));
  } catch {
    return [];
  }
}

function saveWorkspaces(workspaces: Workspace[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
}

function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

function saveActiveId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;

  getActiveWorkspace: () => Workspace;
  createWorkspace: (name: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  addProviderToWorkspace: (workspaceId: string, providerId: string) => void;
  removeProviderFromWorkspace: (workspaceId: string, providerId: string) => void;
  pinProvider: (workspaceId: string, provider: PinnedProvider) => void;
  unpinProvider: (workspaceId: string, providerId: string) => void;
  isProviderInWorkspace: (providerId: string) => boolean;
  updateWorkspaceMessages: (workspaceId: string, messages: UiMessage[], conversation: any[]) => void;
}

const DEFAULT_WORKSPACE: Workspace = {
  id: "default",
  name: "Default",
  providerIds: [],
  pinnedProviders: [],
  conversation: [],
  messages: [],
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const saved = loadWorkspaces();
  const workspaces = saved.length > 0 ? saved : [DEFAULT_WORKSPACE];
  const activeWorkspaceId = loadActiveId() ?? workspaces[0].id;

  return {
    workspaces,
    activeWorkspaceId,

    getActiveWorkspace: () => {
      const { workspaces, activeWorkspaceId } = get();
      return workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0];
    },

    createWorkspace: (name) => {
      const id = `ws-${Date.now()}`;
      const workspace: Workspace = {
        id,
        name,
        providerIds: [],
        pinnedProviders: [],
        conversation: [],
        messages: [],
      };
      set(state => {
        const workspaces = [...state.workspaces, workspace];
        saveWorkspaces(workspaces);
        saveActiveId(id);
        return { workspaces, activeWorkspaceId: id };
      });
      return id;
    },

    renameWorkspace: (id, name) => {
      set(state => {
        const workspaces = state.workspaces.map(w =>
          w.id === id ? { ...w, name } : w
        );
        saveWorkspaces(workspaces);
        return { workspaces };
      });
    },

    deleteWorkspace: (id) => {
      set(state => {
        if (state.workspaces.length <= 1) return state;
        const workspaces = state.workspaces.filter(w => w.id !== id);
        const activeWorkspaceId = state.activeWorkspaceId === id
          ? workspaces[0].id
          : state.activeWorkspaceId;
        saveWorkspaces(workspaces);
        saveActiveId(activeWorkspaceId);
        return { workspaces, activeWorkspaceId };
      });
    },

    setActiveWorkspace: (id) => {
      const { workspaces, activeWorkspaceId } = get();
      const oldWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
      const newWorkspace = workspaces.find(w => w.id === id);

      if (oldWorkspace && newWorkspace && oldWorkspace.id !== newWorkspace.id) {
        // Lazy import to avoid circular deps
        const providerStore = (globalThis as any).__slopProviderStore;
        if (providerStore) {
          // Disconnect providers from old workspace that aren't in the new one
          for (const pid of oldWorkspace.providerIds) {
            if (!newWorkspace.providerIds.includes(pid)) {
              providerStore.getState().disconnectProvider(pid);
            }
          }
          // Connect providers in new workspace that aren't currently connected
          for (const pid of newWorkspace.providerIds) {
            const p = providerStore.getState().providers.get(pid);
            if (p && p.status === "disconnected") {
              providerStore.getState().connectProvider(pid).catch(() => {});
            }
          }
        }
      }

      saveActiveId(id);
      set({ activeWorkspaceId: id });
    },

    addProviderToWorkspace: (workspaceId, providerId) => {
      set(state => {
        const workspaces = state.workspaces.map(w => {
          if (w.id !== workspaceId) return w;
          if (w.providerIds.includes(providerId)) return w;
          return { ...w, providerIds: [...w.providerIds, providerId] };
        });
        saveWorkspaces(workspaces);
        return { workspaces };
      });
    },

    removeProviderFromWorkspace: (workspaceId, providerId) => {
      set(state => {
        const workspaces = state.workspaces.map(w => {
          if (w.id !== workspaceId) return w;
          return { ...w, providerIds: w.providerIds.filter(id => id !== providerId) };
        });
        saveWorkspaces(workspaces);
        return { workspaces };
      });
    },

    pinProvider: (workspaceId, provider) => {
      set(state => {
        const workspaces = state.workspaces.map(w => {
          if (w.id !== workspaceId) return w;
          if (w.pinnedProviders.some(p => p.id === provider.id)) return w;
          return { ...w, pinnedProviders: [...w.pinnedProviders, provider] };
        });
        saveWorkspaces(workspaces);
        return { workspaces };
      });
    },

    unpinProvider: (workspaceId, providerId) => {
      set(state => {
        const workspaces = state.workspaces.map(w => {
          if (w.id !== workspaceId) return w;
          return { ...w, pinnedProviders: w.pinnedProviders.filter(p => p.id !== providerId) };
        });
        saveWorkspaces(workspaces);
        return { workspaces };
      });
    },

    isProviderInWorkspace: (providerId) => {
      const workspace = get().getActiveWorkspace();
      return workspace.providerIds.includes(providerId);
    },

    updateWorkspaceMessages: (workspaceId, messages, conversation) => {
      set(state => {
        const workspaces = state.workspaces.map(w =>
          w.id === workspaceId ? { ...w, messages, conversation } : w
        );
        // Don't save to localStorage on every message (perf)
        return { workspaces };
      });
    },
  };
});
