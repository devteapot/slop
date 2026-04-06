export interface StepResult {
  step: string;
  durationMs: number;
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
}

export type ProtocolLabel = "mcp" | "slop" | "slop-optimized" | "slop-basic";

export interface ProtocolMetrics {
  protocol: ProtocolLabel;
  setupTimeMs: number;
  totalTimeMs: number;
  totalBytesSent: number;
  totalBytesReceived: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  steps: StepResult[];
}

export interface VerificationSummary {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failures: string[];
}

export interface AgentMetrics extends ProtocolMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  llmCalls: number;
  estimatedCostUsd: number;
  verification?: VerificationSummary;
}

/**
 * Pricing per million tokens (USD).
 * Update these when model pricing changes.
 */
export interface ModelPricing {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash": {
    model: "Gemini 2.5 Flash",
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
  "gemini-2.5-pro": {
    model: "Gemini 2.5 Pro",
    inputPerMillion: 1.25,
    outputPerMillion: 10.0,
  },
  "gemini-3-flash-preview": {
    model: "Gemini 3 Flash",
    inputPerMillion: 0.5,
    outputPerMillion: 3.0,
  },
  "gemini-3.1-pro-preview": {
    model: "Gemini 3.1 Pro",
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
  },
  "gpt-4.1-nano": {
    model: "GPT-4.1 nano",
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
  },
  "gpt-4.1-mini": {
    model: "GPT-4.1 mini",
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
  },
  "gpt-4.1": {
    model: "GPT-4.1",
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
  },
  "claude-sonnet-4": {
    model: "Claude Sonnet 4",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  "claude-opus-4": {
    model: "Claude Opus 4",
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
  },
};

export function estimateCost(inputTokens: number, outputTokens: number, model = "gemini-2.5-flash"): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["gemini-2.5-flash"];
  return (inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion;
}

export interface ScenarioResult {
  scenario: string;
  mode: "scripted" | "agent";
  results: (ProtocolMetrics | AgentMetrics)[];
}

export interface BenchmarkReport {
  timestamp: string;
  platform: string;
  mode: "scripted" | "agent" | "all";
  model: string;
  iterations: number;
  scenarios: ScenarioResult[];
}

export interface Scenario {
  name: string;
  description: string;
  agentPrompt: string;
}
