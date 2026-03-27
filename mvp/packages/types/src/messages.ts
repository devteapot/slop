import type { SlopNode } from "./node";

// --- Consumer → Provider ---

export interface SubscribeMessage {
  type: "subscribe";
  id: string;
  path?: string; // default "/"
  depth?: number; // default 1, -1 = unlimited
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  id: string;
}

export interface QueryMessage {
  type: "query";
  id: string;
  path?: string;
  depth?: number;
}

export interface InvokeMessage {
  type: "invoke";
  id: string;
  path: string;
  action: string;
  params?: Record<string, unknown>;
}

export type ConsumerMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | QueryMessage
  | InvokeMessage;

// --- Provider → Consumer ---

export interface HelloMessage {
  type: "hello";
  provider: {
    id: string;
    name: string;
    slop_version: string;
    capabilities: Capability[];
  };
}

export interface SnapshotMessage {
  type: "snapshot";
  id: string;
  version: number;
  tree: SlopNode;
}

export interface PatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

export interface PatchMessage {
  type: "patch";
  subscription: string;
  version: number;
  ops: PatchOp[];
}

export interface ResultMessage {
  type: "result";
  id: string;
  status: "ok" | "error";
  data?: unknown;
  error?: { code: ErrorCode; message: string };
}

export type ProviderMessage =
  | HelloMessage
  | SnapshotMessage
  | PatchMessage
  | ResultMessage;

export type SlopMessage = ConsumerMessage | ProviderMessage;

export type Capability =
  | "state"
  | "patches"
  | "affordances"
  | "attention";

export type ErrorCode =
  | "not_found"
  | "invalid_params"
  | "unauthorized"
  | "conflict"
  | "internal";
