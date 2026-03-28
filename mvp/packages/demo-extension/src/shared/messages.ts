import type { SlopMessage, SlopNode } from "./types";

// Content script → Background
export type ContentMessage =
  | { type: "slop-discovered"; transport: "ws" | "postmessage"; endpoint?: string }
  | { type: "slop-lost" }
  | { type: "user-message"; text: string }
  | { type: "get-state" }
  | { type: "get-status" }
  | { type: "get-profiles" }
  | { type: "set-active-profile"; profileId: string }
  | { type: "fetch-models" }
  | { type: "set-model"; model: string }
  | { type: "slop-from-provider"; message: SlopMessage };

// Background → Content script
export type BackgroundMessage =
  | { type: "connection-status"; status: "disconnected" | "connecting" | "connected"; providerName?: string }
  | { type: "state-update"; formattedTree: string; toolCount: number }
  | { type: "chat-message"; role: "assistant" | "tool-progress"; content: string }
  | { type: "chat-done" }
  | { type: "chat-error"; message: string }
  | { type: "profiles"; profiles: LlmProfile[]; activeProfileId: string }
  | { type: "models"; models: string[]; activeModel: string }
  | { type: "slop-to-provider"; message: SlopMessage };

// Settings

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
