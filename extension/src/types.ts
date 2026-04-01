import type { SlopNode } from "@slop-ai/consumer/browser";

// ========================================================================
// Content -> Background messages
// ========================================================================

export type ContentMessage =
  | { type: "discovered"; providers: ProviderSpec[] }
  | { type: "lost" }
  | { type: "send"; text: string }
  | { type: "get-profiles" }
  | { type: "set-profile"; profileId: string }
  | { type: "get-models" }
  | { type: "set-model"; model: string }
  | { type: "slop-up"; message: any };

// ========================================================================
// Background -> Content messages
// ========================================================================

export type BackgroundMessage =
  | { type: "status"; status: ConnectionStatus; providerName?: string }
  | { type: "tree"; formatted: string; toolCount: number }
  | { type: "assistant"; content: string }
  | { type: "progress"; content: string }
  | { type: "error"; message: string }
  | { type: "input-ready" }
  | { type: "profiles"; profiles: LlmProfile[]; activeId: string }
  | { type: "models"; models: string[]; active: string }
  | { type: "bridge-active"; active: boolean }
  | { type: "slop-down"; message: any };

// ========================================================================
// Shared types
// ========================================================================

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ProviderSpec {
  transport: "ws" | "postmessage";
  endpoint?: string;
}

// ========================================================================
// LLM profiles
// ========================================================================

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

// ========================================================================
// Extension preferences
// ========================================================================

export interface ExtensionPrefs {
  active: boolean;
  chatUIEnabled: boolean;
  bridgeEnabled: boolean;
}

export const DEFAULT_PREFS: ExtensionPrefs = {
  active: true,
  chatUIEnabled: true,
  bridgeEnabled: false,
};

export async function getPrefs(): Promise<ExtensionPrefs> {
  const result = await chrome.storage.local.get("prefs");
  return { ...DEFAULT_PREFS, ...result.prefs };
}

export async function savePrefs(prefs: ExtensionPrefs): Promise<void> {
  await chrome.storage.local.set({ prefs });
}
