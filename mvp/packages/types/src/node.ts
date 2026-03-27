import type { Affordance } from "./affordance";

export interface SlopNode {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  children?: SlopNode[];
  affordances?: Affordance[];
  meta?: NodeMeta;
}

/** A stub is a depth-truncated node — id, type, meta only */
export interface NodeStub {
  id: string;
  type: string;
  meta?: NodeMeta;
}

export interface NodeMeta {
  summary?: string;
  salience?: number; // 0–1
  changed?: boolean;
  focus?: boolean;
  urgency?: "none" | "low" | "medium" | "high" | "critical";
  reason?: string;
  total_children?: number;
  window?: [number, number]; // [offset, limit]
  created?: string; // ISO 8601
  updated?: string; // ISO 8601
}
