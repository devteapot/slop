// SLOP types — merged from @slop-ai/types for browser use

export interface SlopNode {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  children?: SlopNode[];
  affordances?: Affordance[];
  meta?: NodeMeta;
  content_ref?: ContentRef;
}

export interface ContentRef {
  type: "text" | "binary" | "stream";
  mime: string;
  size?: number;
  uri?: string;
  summary: string;
  preview?: string;
  encoding?: string;
  hash?: string;
}

export interface NodeMeta {
  summary?: string;
  salience?: number;
  pinned?: boolean;
  changed?: boolean;
  focus?: boolean;
  urgency?: "none" | "low" | "medium" | "high" | "critical";
  reason?: string;
  total_children?: number;
  window?: [number, number];
  created?: string;
  updated?: string;
}

export interface Affordance {
  action: string;
  label?: string;
  description?: string;
  params?: JsonSchema;
  dangerous?: boolean;
  idempotent?: boolean;
}

export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};

// Messages

export interface SubscribeMessage { type: "subscribe"; id: string; path?: string; depth?: number; }
export interface UnsubscribeMessage { type: "unsubscribe"; id: string; }
export interface QueryMessage { type: "query"; id: string; path?: string; depth?: number; }
export interface InvokeMessage { type: "invoke"; id: string; path: string; action: string; params?: Record<string, unknown>; }

export type ConsumerMessage = SubscribeMessage | UnsubscribeMessage | QueryMessage | InvokeMessage;

export interface HelloMessage { type: "hello"; provider: { id: string; name: string; slop_version: string; capabilities: string[]; }; }
export interface SnapshotMessage { type: "snapshot"; id: string; version: number; tree: SlopNode; }
export interface PatchOp { op: "add" | "remove" | "replace"; path: string; value?: unknown; }
export interface PatchMessage { type: "patch"; subscription: string; version: number; ops: PatchOp[]; }
export interface ResultMessage { type: "result"; id: string; status: "ok" | "error" | "accepted"; data?: unknown; error?: { code: string; message: string }; }
export interface ErrorMessage { type: "error"; id?: string; error: { code: string; message: string }; }
export interface EventMessage { type: "event"; name: string; data?: unknown; }
export interface BatchMessage { type: "batch"; messages: ProviderMessage[]; }

export type ProviderMessage = HelloMessage | SnapshotMessage | PatchMessage | ResultMessage | ErrorMessage | EventMessage | BatchMessage;
export type SlopMessage = ConsumerMessage | ProviderMessage;

// Transport

export type MessageHandler = (message: SlopMessage) => void;

export interface Connection {
  send(message: SlopMessage): void;
  onMessage(handler: MessageHandler): void;
  onClose(handler: () => void): void;
  close(): void;
}

export interface ClientTransport {
  connect(): Promise<Connection>;
}
