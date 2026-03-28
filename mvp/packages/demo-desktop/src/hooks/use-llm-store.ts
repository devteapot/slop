import { create } from "zustand";
import type { LlmProfile, SlopStorage } from "../slop/profiles";
import { DEFAULT_STORAGE, getActiveProfile } from "../slop/profiles";
import { fetchModels as fetchModelsApi } from "../slop/llm";

const STORAGE_KEY = "slopStorage";

function loadStorage(): SlopStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_STORAGE;
  } catch {
    return DEFAULT_STORAGE;
  }
}

function saveStorage(storage: SlopStorage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
}

interface LlmState {
  profiles: LlmProfile[];
  activeProfileId: string;
  models: string[];
  modelsLoading: boolean;

  getActiveProfile: () => LlmProfile;
  addProfile: (profile: LlmProfile) => void;
  updateProfile: (id: string, updates: Partial<LlmProfile>) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
  setModel: (model: string) => void;
  fetchModels: () => Promise<void>;
}

export const useLlmStore = create<LlmState>((set, get) => {
  const initial = loadStorage();
  return {
    profiles: initial.profiles,
    activeProfileId: initial.activeProfileId,
    models: [],
    modelsLoading: false,

    getActiveProfile: () => {
      const { profiles, activeProfileId } = get();
      return getActiveProfile({ profiles, activeProfileId });
    },

    addProfile: (profile) => {
      set(state => {
        const profiles = [...state.profiles, profile];
        const storage = { profiles, activeProfileId: profile.id };
        saveStorage(storage);
        return storage;
      });
    },

    updateProfile: (id, updates) => {
      set(state => {
        const profiles = state.profiles.map(p => p.id === id ? { ...p, ...updates } : p);
        const storage = { profiles, activeProfileId: state.activeProfileId };
        saveStorage(storage);
        return { profiles };
      });
    },

    deleteProfile: (id) => {
      set(state => {
        const profiles = state.profiles.filter(p => p.id !== id);
        let activeProfileId = state.activeProfileId;
        if (activeProfileId === id && profiles.length > 0) {
          activeProfileId = profiles[0].id;
        }
        const storage = { profiles, activeProfileId };
        saveStorage(storage);
        return storage;
      });
    },

    setActiveProfile: (id) => {
      set(state => {
        const storage = { profiles: state.profiles, activeProfileId: id };
        saveStorage(storage);
        return { activeProfileId: id };
      });
    },

    setModel: (model) => {
      set(state => {
        const profiles = state.profiles.map(p =>
          p.id === state.activeProfileId ? { ...p, model } : p
        );
        const storage = { profiles, activeProfileId: state.activeProfileId };
        saveStorage(storage);
        return { profiles };
      });
    },

    fetchModels: async () => {
      set({ modelsLoading: true });
      const profile = get().getActiveProfile();
      const models = await fetchModelsApi(profile);
      set({ models, modelsLoading: false });
    },
  };
});
