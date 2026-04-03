import type {
  ConsumerMessage,
  ProviderMessage,
  SlopNode,
} from "@slop-ai/consumer/browser";
export type {
  ConsumerMessage,
  ProviderMessage,
  SlopNode,
} from "@slop-ai/consumer/browser";

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
  | { type: "set-model"; model: string };

export interface ProviderRelayMessage {
  type: "slop-from-provider";
  message: ProviderMessage;
}

export interface RelayConnectMessage {
  type: "connect";
}

export type RelayConsumerMessage = ConsumerMessage | RelayConnectMessage;

export interface ConsumerRelayMessage {
  type: "slop-to-provider";
  message: RelayConsumerMessage;
}

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
  | ConsumerRelayMessage;

export type PortMessageFromContent = ContentMessage | ProviderRelayMessage;
export type PortMessageToContent = BackgroundMessage;

export interface BridgeProviderInfo {
  id: string;
  name: string;
  transport: "ws" | "postmessage";
  url?: string;
}

export type BridgeMessageToDesktop =
  | { type: "provider-available"; tabId: number; providerKey: string; provider: BridgeProviderInfo }
  | { type: "provider-unavailable"; tabId: number; providerKey: string }
  | { type: "slop-relay"; providerKey: string; message: ProviderMessage };

export type BridgeMessageFromDesktop =
  | { type: "relay-open"; providerKey: string }
  | { type: "relay-close"; providerKey: string }
  | { type: "slop-relay"; providerKey: string; message: RelayConsumerMessage };

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

export interface PrefsStorageRecord {
  prefs?: Partial<ExtensionPrefs>;
}

export interface SlopStorageRecord {
  slopStorage?: SlopStorage;
}

export const DEFAULT_PREFS: ExtensionPrefs = {
  active: true,
  chatUIEnabled: true,
  bridgeEnabled: false,
};

export async function getPrefs(): Promise<ExtensionPrefs> {
  const result = await chrome.storage.local.get("prefs") as PrefsStorageRecord;
  return { ...DEFAULT_PREFS, ...result.prefs };
}

export async function savePrefs(prefs: ExtensionPrefs): Promise<void> {
  await chrome.storage.local.set({ prefs });
}

export type PopupCommandMessage =
  | { type: "scan-page" }
  | { type: "stop-scan" }
  | { type: "get-scan-status" }
  | { type: "get-slop-status" };

export type PopupResponse =
  | { status: "inactive" | "scanning" | "stopped" }
  | { scanning: boolean; hasSlop: boolean }
  | { hasSlop: boolean; providers: ProviderSpec[]; providerName: string };
