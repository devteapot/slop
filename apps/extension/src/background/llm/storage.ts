import type { SlopStorage, LlmProfile } from "../../types";
import { DEFAULT_STORAGE, getActiveProfile } from "../../types";

export async function getStorage(): Promise<SlopStorage> {
  const result = await chrome.storage.sync.get("slopStorage");
  return result.slopStorage ?? DEFAULT_STORAGE;
}

export async function saveStorage(storage: SlopStorage): Promise<void> {
  await chrome.storage.sync.set({ slopStorage: storage });
}

export async function setActiveModel(model: string): Promise<void> {
  const storage = await getStorage();
  const profile = storage.profiles.find(p => p.id === storage.activeProfileId);
  if (profile) {
    profile.model = model;
    await saveStorage(storage);
  }
}
