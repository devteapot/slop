export interface LlmProfile {
  id: string;
  name: string;
  llmProvider: "ollama" | "openai" | "openrouter" | "gemini";
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface SlopStorage {
  profiles: LlmProfile[];
  activeProfileId: string;
}

export const DEFAULT_PROFILE: LlmProfile = {
  id: "default",
  name: "Ollama Local",
  llmProvider: "ollama",
  endpoint: "http://localhost:11434",
  apiKey: "",
  model: "qwen2.5:14b",
};

export const DEFAULT_STORAGE: SlopStorage = {
  profiles: [DEFAULT_PROFILE],
  activeProfileId: "default",
};

export function getActiveProfile(storage: SlopStorage): LlmProfile {
  return storage.profiles.find(p => p.id === storage.activeProfileId) ?? storage.profiles[0] ?? DEFAULT_PROFILE;
}
