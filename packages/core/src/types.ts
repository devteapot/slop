// --- Wire protocol types (SLOP spec) ---

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
  params?: JsonSchema;
  dangerous?: boolean;
  idempotent?: boolean;
}

export interface NodeMeta {
  summary?: string;
  salience?: number;
  changed?: boolean;
  focus?: boolean;
  urgency?: "none" | "low" | "medium" | "high" | "critical";
  reason?: string;
  total_children?: number;
  window?: [number, number];
  created?: string;
  updated?: string;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface PatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

// --- Developer-facing descriptor types ---

export type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

export type ParamDef = string | { type: string; description?: string; enum?: unknown[] };

export type Action = ActionHandler | {
  handler: ActionHandler;
  params?: Record<string, ParamDef>;
  label?: string;
  description?: string;
  dangerous?: boolean;
  idempotent?: boolean;
};

export interface ItemDescriptor {
  id: string;
  props?: Record<string, unknown>;
  actions?: Record<string, Action>;
  meta?: Partial<NodeMeta>;
  children?: Record<string, NodeDescriptor>;
}

export interface NodeDescriptor {
  type: string;
  props?: Record<string, unknown>;
  items?: ItemDescriptor[];
  children?: Record<string, NodeDescriptor>;
  actions?: Record<string, Action>;
  meta?: Partial<NodeMeta>;
}

// --- Client types ---

export interface SlopClientOptions<S = unknown> {
  id: string;
  name: string;
  schema?: S;
}

export interface SlopClient<S = unknown> {
  register(path: string, descriptor: NodeDescriptor): void;
  unregister(path: string, opts?: { recursive?: boolean }): void;
  scope(path: string, descriptor?: NodeDescriptor): SlopClient<unknown>;
  flush(): void;
  stop(): void;
}
