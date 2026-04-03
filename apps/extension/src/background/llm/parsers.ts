import type { ChatMessage } from "@slop-ai/consumer/browser";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown, context: string): JsonObject {
  if (!isObject(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function asArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string`);
  }
  return value;
}

function asOptionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseOllamaModelNames(payload: unknown): string[] {
  const root = asObject(payload, "Ollama model list response");
  return asArray(root.models, "Ollama model list response.models")
    .map((model, index) => asObject(model, `Ollama model ${index + 1}`))
    .map((model, index) => asString(model.name, `Ollama model ${index + 1}.name`));
}

export function parseOpenAIModelNames(payload: unknown): string[] {
  const root = asObject(payload, "OpenAI model list response");
  return asArray(root.data, "OpenAI model list response.data")
    .map((model, index) => asObject(model, `OpenAI model ${index + 1}`))
    .map((model, index) => asString(model.id, `OpenAI model ${index + 1}.id`));
}

export function parseGeminiModelNames(payload: unknown): string[] {
  const root = asObject(payload, "Gemini model list response");
  return asArray(root.models, "Gemini model list response.models")
    .map((model, index) => asObject(model, `Gemini model ${index + 1}`))
    .filter((model) => asOptionalStringArray(model.supportedGenerationMethods).includes("generateContent"))
    .map((model, index) =>
      asString(model.name, `Gemini model ${index + 1}.name`).replace("models/", ""))
    .sort();
}

export function parseChatMessage(payload: unknown): ChatMessage {
  const root = asObject(payload, "OpenAI chat response message");
  const role = asString(root.role, "OpenAI chat response message.role");
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
    throw new Error(`Unsupported chat role: ${role}`);
  }

  const message: ChatMessage = {
    role,
    content: typeof root.content === "string" ? root.content : "",
  };

  if (typeof root.tool_call_id === "string") {
    message.tool_call_id = root.tool_call_id;
  }

  if (Array.isArray(root.tool_calls)) {
    message.tool_calls = root.tool_calls.map((call, index) => parseToolCall(call, index));
  }

  return message;
}

function parseToolCall(value: unknown, index: number): NonNullable<ChatMessage["tool_calls"]>[number] {
  const toolCall = asObject(value, `tool call ${index + 1}`);
  const fn = asObject(toolCall.function, `tool call ${index + 1}.function`);
  const argumentsValue = fn.arguments;
  return {
    id: asString(toolCall.id, `tool call ${index + 1}.id`),
    type: "function",
    function: {
      name: asString(fn.name, `tool call ${index + 1}.function.name`),
      arguments:
        typeof argumentsValue === "string"
          ? argumentsValue
          : JSON.stringify(argumentsValue ?? {}),
    },
  };
}

export interface GeminiResponsePart {
  text?: string;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
  };
}

export function parseGeminiResponseParts(payload: unknown): GeminiResponsePart[] {
  const root = asObject(payload, "Gemini response");
  const candidates = asArray(root.candidates, "Gemini response.candidates");
  const candidate = asObject(candidates[0], "Gemini response.candidates[0]");
  const content = asObject(candidate.content, "Gemini response.candidates[0].content");
  return asArray(content.parts, "Gemini response.candidates[0].content.parts").map((part, index) => {
    const rawPart = asObject(part, `Gemini response part ${index + 1}`);
    const parsed: GeminiResponsePart = {};

    if (typeof rawPart.text === "string") {
      parsed.text = rawPart.text;
    }

    if (isObject(rawPart.functionCall)) {
      const args = isObject(rawPart.functionCall.args)
        ? rawPart.functionCall.args
        : undefined;
      parsed.functionCall = {
        name: asString(rawPart.functionCall.name, `Gemini response part ${index + 1}.functionCall.name`),
        ...(args ? { args } : {}),
      };
    }

    return parsed;
  });
}
