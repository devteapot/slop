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
    inputPerMillion: 0.30,
    outputPerMillion: 2.50,
  },
  "gemini-2.5-pro": {
    model: "Gemini 2.5 Pro",
    inputPerMillion: 1.25,
    outputPerMillion: 10.00,
  },
  "gemini-3-flash-preview": {
    model: "Gemini 3 Flash",
    inputPerMillion: 0.50,
    outputPerMillion: 3.00,
  },
  "gemini-3.1-pro-preview": {
    model: "Gemini 3.1 Pro",
    inputPerMillion: 2.00,
    outputPerMillion: 12.00,
  },
  "gpt-4.1-nano": {
    model: "GPT-4.1 nano",
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
  },
  "gpt-4.1-mini": {
    model: "GPT-4.1 mini",
    inputPerMillion: 0.40,
    outputPerMillion: 1.60,
  },
  "gpt-4.1": {
    model: "GPT-4.1",
    inputPerMillion: 2.00,
    outputPerMillion: 8.00,
  },
  "claude-sonnet-4": {
    model: "Claude Sonnet 4",
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
  },
  "claude-opus-4": {
    model: "Claude Opus 4",
    inputPerMillion: 15.00,
    outputPerMillion: 75.00,
  },
};

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model = "gemini-2.5-flash",
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["gemini-2.5-flash"];
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export interface ScenarioResult {
  scenario: string;
  mode: "scripted" | "agent";
  results: (ProtocolMetrics | AgentMetrics)[];
}

export interface BenchmarkReport {
  timestamp: string;
  platform: string;
  mode: "scripted" | "agent";
  model: string;
  iterations: number;
  scenarios: ScenarioResult[];
}

export interface Scenario {
  name: string;
  description: string;
  agentPrompt: string;
}
