export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type FinishReason = "stop" | "tool_calls" | "length" | "error";

export interface GenerateRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResponse {
  message: ChatMessage;
  usage: LlmUsage;
  finishReason: FinishReason;
  rawLatencyMs: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
}
