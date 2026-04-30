import type { PatchOp, SlopNode } from "@slop-ai/consumer";

export const RELAY_PROTOCOL_VERSION = 1;
export const DEFAULT_RELAY_URL = "wss://bridge.slopai.dev/relay";

export interface ProviderSummary {
  id: string;
  name: string;
  transport: "unix" | "ws" | "stdio" | "relay";
  source: "local" | "bridge";
  status: "connected" | "connecting" | "disconnected";
  capabilities?: string[];
}

export type Up =
  | { t: "hello"; relayVersion: string; protocolVersion: typeof RELAY_PROTOCOL_VERSION }
  | { t: "providers"; list: ProviderSummary[] }
  | { t: "snapshot"; reqId: string; subId: string; tree: SlopNode; version?: number; seq?: number }
  | { t: "patch"; subId: string; ops: PatchOp[]; version: number; seq?: number }
  | { t: "result"; reqId: string; ok: true; data?: unknown }
  | { t: "result"; reqId: string; ok: false; error: { code: string; message: string } };

export type Down =
  | { t: "subscribe"; reqId: string; subId: string; providerId: string; path?: string; depth?: number }
  | { t: "unsubscribe"; subId: string }
  | { t: "invoke"; reqId: string; providerId: string; path: string; action: string; params?: Record<string, unknown> }
  | { t: "ping" };

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export function isDownFrame(value: unknown): value is Down {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  switch (frame.t) {
    case "subscribe":
      return typeof frame.reqId === "string" && typeof frame.subId === "string" && typeof frame.providerId === "string";
    case "unsubscribe":
      return typeof frame.subId === "string";
    case "invoke":
      return (
        typeof frame.reqId === "string" &&
        typeof frame.providerId === "string" &&
        typeof frame.path === "string" &&
        typeof frame.action === "string"
      );
    case "ping":
      return true;
    default:
      return false;
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
