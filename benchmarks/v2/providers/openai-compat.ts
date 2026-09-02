import type {
  ChatMessage,
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  LlmProvider,
  ToolCall,
} from "./types.ts";

export interface OpenAICompatOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  id?: string;
  requestTimeoutMs?: number;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIChatResponse {
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAICompatProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: OpenAICompatOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? "dummy-key";
    this.id = opts.id ?? `openai-compat:${opts.model}`;
    this.timeoutMs = opts.requestTimeoutMs ?? 180_000;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const messages: OpenAIMessage[] = [
      { role: "system", content: req.systemPrompt },
      ...req.messages.map(toOpenAIMessage),
    ];

    const body = {
      model: this.model,
      messages,
      tools: req.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: req.tools.length > 0 ? "auto" : undefined,
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens,
    };

    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const rawLatencyMs = performance.now() - t0;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI-compat ${this.baseUrl} ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as OpenAIChatResponse;
    const choice = json.choices[0];
    if (!choice) throw new Error("OpenAI-compat response has no choices");
    const message = fromOpenAIMessage(choice.message);
    const finishReason = normaliseFinishReason(choice.finish_reason);
    const usage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      totalTokens:
        json.usage?.total_tokens ??
        (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
    };

    return { message, usage, finishReason, rawLatencyMs };
  }
}

function toOpenAIMessage(m: ChatMessage): OpenAIMessage {
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    };
  }
  if (m.role === "tool") {
    return {
      role: "tool",
      content: m.content,
      tool_call_id: m.toolCallId,
      name: m.name,
    };
  }
  return { role: m.role, content: m.content };
}

function fromOpenAIMessage(m: OpenAIMessage): ChatMessage {
  const toolCalls: ToolCall[] | undefined = m.tool_calls?.map((c) => ({
    id: c.id,
    name: c.function.name,
    arguments: parseArgs(c.function.arguments),
  }));
  return {
    role: (m.role as ChatMessage["role"]) ?? "assistant",
    content: m.content ?? "",
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function normaliseFinishReason(raw: string | null): FinishReason {
  switch (raw) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
    case "max_tokens":
      return "length";
    case "stop":
    case "end_turn":
    case null:
      return "stop";
    default:
      return "stop";
  }
}
