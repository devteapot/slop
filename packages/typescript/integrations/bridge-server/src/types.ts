import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PatchOp, SlopNode } from "@slop-ai/consumer";
import type { Down, ProviderSummary, Up } from "./protocol";

export type ToolContent = { type: "text"; text: string };
export type ToolResult = CallToolResult & {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
};

export interface ActionSummary {
  name: string;
  description: string;
  path: string | null;
  action: string;
  targets?: string[];
  parameters: Record<string, unknown>;
}

export interface StateProviderSummary extends ProviderSummary {
  connected: boolean;
}

export interface SelectedProviderState {
  id: string;
  name: string;
  tree: SlopNode;
  formatted: string;
  actions: ActionSummary[];
  stale?: boolean;
}

export interface StatePayload {
  updatedAt: number;
  providers: StateProviderSummary[];
  selected?: SelectedProviderState;
}

export type PendingRequest = {
  resolve: (frame: Up) => void;
  reject: (error: RelayError) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RelayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

export interface RelaySubscription {
  userId: string;
  sessionId: string;
  providerId: string;
  subId: string;
  onSnapshot: (frame: Extract<Up, { t: "snapshot" }>) => void;
  onPatch: (ops: PatchOp[], version: number, seq?: number) => void;
  onStale: (error: RelayError) => void;
}

export interface RelaySocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RelayState {
  userId: string;
  socket: RelaySocketLike | null;
  providers: ProviderSummary[];
  pending: Map<string, PendingRequest>;
  subs: Map<string, RelaySubscription>;
  online: boolean;
  relayVersion?: string;
}

export type RelaySendOptions = {
  expectReply?: boolean;
  timeoutMs?: number;
};

export interface RelayHub {
  getState(userId: string): RelayState | null;
  getOrCreateState(userId: string): RelayState;
  acceptRelay(userId: string, socket: RelaySocketLike): void;
  handleRelayFrame(userId: string, frame: Up): void;
  closeRelay(userId: string): void;
  subscribe(input: {
    userId: string;
    sessionId: string;
    providerId: string;
    onSnapshot: RelaySubscription["onSnapshot"];
    onPatch: RelaySubscription["onPatch"];
    onStale: RelaySubscription["onStale"];
  }): Promise<{ subId: string; snapshot: Extract<Up, { t: "snapshot" }> }>;
  unsubscribe(userId: string, subId: string): void;
  invoke(input: {
    userId: string;
    providerId: string;
    path: string;
    action: string;
    params?: Record<string, unknown>;
  }): Promise<Extract<Up, { t: "result" }>>;
  markSessionClosed(userId: string, sessionId: string): void;
  resubscribeSession(userId: string, sessionId: string): void;
}

export type BridgeLogger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type WebSocketReadyState = {
  OPEN: number;
};

export type RelayFrame = Down | Up;
