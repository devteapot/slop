import { createHash } from "node:crypto";
import type { Cell, SweepConfig } from "./types.ts";

/**
 * Canonicalize a value into a deterministic JSON string: object keys sorted,
 * arrays preserved in order, primitives as-is. Two cells that should hash to
 * the same value must stringify identically.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Deterministic ID for a cell, independent of iteration index. Two cells with
 * the same configHash should produce identical runs (given a fixed seed).
 */
export function configHash(sweep: SweepConfig, cell: Cell): string {
  const snapshot = {
    sweep: {
      maxTurns: sweep.maxTurns,
      temperature: sweep.temperature,
    },
    cell: {
      provider: cell.provider,
      prompt: cell.prompt,
      encoding: cell.encoding,
      optimization: cell.optimization,
      protocol: cell.protocol,
      mcpVariant: cell.mcpVariant ?? null,
      app: cell.app,
      scale: cell.scale,
      scenario: cell.scenario,
      seed: cell.seed,
    },
  };
  return sha256Hex(canonicalize(snapshot)).slice(0, 16);
}

export function cellLabel(cell: Cell): string {
  const parts = [
    cell.app,
    cell.scale,
    cell.scenario,
    cell.protocol,
    cell.protocol === "mcp" ? (cell.mcpVariant ?? "flat") : `${cell.prompt}/${cell.encoding}/${cell.optimization}`,
    `${cell.provider.kind}:${cell.provider.model}`,
    `seed=${cell.seed}`,
    `iter=${cell.iteration}`,
  ];
  return parts.join(" | ");
}

export function runId(sweepId: string, cell: Cell, cfgHash: string): string {
  return `${sweepId}:${cfgHash}:${cell.iteration}`;
}
