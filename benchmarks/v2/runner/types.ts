export type AppId = "issue-tracker" | "todo" | "file-browser" | "crm";
export type DataScale = "s" | "m" | "l" | "xl";
export type Protocol = "slop" | "mcp";

export interface ProviderConfig {
  kind: "openai-compat" | "gemini" | "anthropic";
  baseUrl?: string;
  model: string;
  apiKey?: string;
  id?: string;
}

export interface SweepConfig {
  id: string;
  providers: ProviderConfig[];
  promptVariants: string[];
  encodingVariants: string[];
  optimizationVariants: string[];
  protocols: Protocol[];
  mcpVariants?: string[];
  apps: AppId[];
  dataScales: DataScale[];
  scenarioFilter?: string[];
  seeds: number[];
  iterations: number;
  maxConcurrency: number;
  maxTurns: number;
  temperature: number;
}

export interface Cell {
  provider: ProviderConfig;
  prompt: string;
  encoding: string;
  optimization: string;
  protocol: Protocol;
  mcpVariant?: string;
  app: AppId;
  scale: DataScale;
  scenario: string;
  seed: number;
  iteration: number;
}

export interface TurnMetric {
  index: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  toolCalls: number;
  /** Assistant tool calls classified in this turn, for taxonomy. */
  toolCallKinds: ("slop_query" | "slop_get_state" | "affordance" | "unknown" | "param_error" | "invoke_error")[];
}

export interface CellMetrics {
  turns: number;
  toolCalls: number;
  navigationToolCalls: number;
  affordanceToolCalls: number;
  unknownToolCalls: number;
  /** Calls that hit the right affordance but threw during invoke. */
  invokeErrorCalls: number;
  /** Calls that resolved to a valid affordance but had malformed params. */
  paramErrorCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Max prompt_tokens observed on any single turn — proxy for peak context pressure. */
  maxContextTokens: number;
  /** Wall-clock ms from user prompt send to first assistant tool call. null = never called a tool. */
  timeToFirstToolCallMs: number | null;
  setupTimeMs: number;
  llmTimeMs: number;
  totalTimeMs: number;
  transportBytesSent: number;
  transportBytesReceived: number;
  /** affordanceToolCalls / (affordanceToolCalls + unknownToolCalls + paramErrorCalls). 1.0 = every tool call was a valid affordance. */
  specComplianceRate: number;
  finishReason: "done" | "max_turns" | "error";
  turnBreakdown: TurnMetric[];
  verification?: {
    passed: boolean;
    totalChecks: number;
    passedChecks: number;
    failures: string[];
  };
}

export interface RunRecord {
  sweepId: string;
  cellId: string;
  runId: string;
  configHash: string;
  cell: Cell;
  metrics?: CellMetrics;
  error?: string;
  startedAt: string;
  durationMs: number;
}
