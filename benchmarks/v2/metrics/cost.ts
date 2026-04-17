import type { ProviderConfig } from "../runner/types.ts";

/**
 * Pricing per million tokens (USD). Local models on DGX cost $0 — we track
 * them with zeros so cost-per-success is consistent across the matrix and the
 * dashboard can still show the ratio.
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Local — DGX Ollama
  "gemma4:31b": { inputPerMillion: 0, outputPerMillion: 0 },
  "gemma4:e2b-it": { inputPerMillion: 0, outputPerMillion: 0 },
  "gemma4:e4b-it": { inputPerMillion: 0, outputPerMillion: 0 },
  "gemma4:26b-a4b-it": { inputPerMillion: 0, outputPerMillion: 0 },
  "gemma4:31b-it": { inputPerMillion: 0, outputPerMillion: 0 },
  "nemotron-3-super:120b": { inputPerMillion: 0, outputPerMillion: 0 },
  // API reference anchors (mirror v1 pricing table).
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1": { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  "claude-sonnet-4": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-opus-4": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
};

export function estimateCostUsd(provider: ProviderConfig, inputTokens: number, outputTokens: number): number {
  const p = PRICING[provider.model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.inputPerMillion + (outputTokens / 1_000_000) * p.outputPerMillion;
}

export function isLocal(provider: ProviderConfig): boolean {
  const p = PRICING[provider.model];
  return p !== undefined && p.inputPerMillion === 0 && p.outputPerMillion === 0;
}
