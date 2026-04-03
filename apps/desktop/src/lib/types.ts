// Types matching Rust serde structs

export interface WorkspaceSummary {
  id: string;
  name: string;
  provider_ids: string[];
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  provider_ids: string[];
  ui_messages: UiMessage[];
}

export interface ProviderSummary {
  id: string;
  name: string;
  transport_type: string; // "ws" | "unix" | "relay"
  source: string; // "discovered" | "manual" | "bridge"
  status: string; // "disconnected" | "connecting" | "connected" | "error"
  provider_name?: string;
}

export interface ProviderConnectResult {
  provider_name: string;
  tree: SlopNode;
}

export interface SlopNode {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  children?: SlopNode[];
  affordances?: Affordance[];
  meta?: NodeMeta;
}

export interface Affordance {
  action: string;
  label?: string;
  description?: string;
  params?: unknown;
  dangerous?: boolean;
}

export interface NodeMeta {
  summary?: string;
  salience?: number;
  pinned?: boolean;
  changed?: boolean;
  focus?: boolean;
  urgency?: string;
  total_children?: number;
}

export interface UiMessage {
  id: string;
  role: string; // "user" | "assistant" | "tool-progress" | "error"
  content: string;
  timestamp: number;
}

export interface LlmProfile {
  id: string;
  name: string;
  provider: string; // "ollama" | "openai" | "openrouter" | "gemini"
  endpoint: string;
  api_key: string;
  model: string;
}

// Event payloads

export interface ProviderStatusPayload {
  provider_id: string;
  status: string;
  provider_name?: string;
  tree?: SlopNode;
  message?: string;
}

export interface ChatMessagePayload {
  workspace_id: string;
  message: UiMessage;
}

export interface ChatProcessingPayload {
  workspace_id: string;
  processing: boolean;
}

export interface ProfilesChangedPayload {
  profiles: LlmProfile[];
  active_id: string;
}

export interface ProviderDiscoveredPayload {
  provider: ProviderSummary;
}

export interface ProviderRemovedPayload {
  provider_id: string;
}

export interface WorkspacesChangedPayload {
  workspaces: WorkspaceSummary[];
}
