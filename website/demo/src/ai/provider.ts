/**
 * LLM provider abstraction — ported from the extension's battle-tested llm.ts
 * (extension/src/background/llm.ts).
 *
 * Uses the ChatMessage format from @slop-ai/consumer as the canonical
 * conversation format (matches OpenAI's schema). Each provider converts
 * internally:
 * - OpenAI/OpenRouter: passthrough (native format)
 * - Anthropic: tool_calls → tool_use content blocks, tool results → tool_result blocks
 * - Gemini: tool names mapped to tool_N (strict alphanumeric requirement),
 *   tool_calls → functionCall parts, tool results → functionResponse parts
 */

import type { ChatMessage, LlmTool } from "@slop-ai/consumer/browser";

export interface LLMConfig {
  provider: "openrouter" | "openai" | "anthropic" | "google";
  apiKey: string;
  model?: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  openrouter: "anthropic/claude-sonnet-4",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-flash",
};

/**
 * Send a chat completion request. Uses the ChatMessage format from
 * @slop-ai/consumer (same as OpenAI's format) as the canonical conversation
 * format. Each provider converts internally.
 */
export async function chatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  tools: LlmTool[],
): Promise<ChatMessage> {
  if (config.provider === "google") {
    return geminiChatCompletion(config, messages, tools);
  }
  if (config.provider === "anthropic") {
    return anthropicChatCompletion(config, messages, tools);
  }
  return openaiChatCompletion(config, messages, tools);
}

// --- OpenAI-compatible (OpenAI, OpenRouter) ---

async function openaiChatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  tools: LlmTool[],
): Promise<ChatMessage> {
  const model = config.model ?? DEFAULT_MODELS[config.provider];
  const baseUrl = config.provider === "openrouter"
    ? "https://openrouter.ai/api"
    : "https://api.openai.com";
  const url = `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/slop-ai/slop";
    headers["X-Title"] = "SLOP Demo";
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  return data.choices[0].message;
}

// --- Anthropic ---

async function anthropicChatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  tools: LlmTool[],
): Promise<ChatMessage> {
  const model = config.model ?? DEFAULT_MODELS.anthropic;

  // Extract system message
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  // Convert OpenAI message format → Anthropic format
  const anthropicMessages: any[] = [];
  for (const msg of nonSystem) {
    if (msg.role === "user") {
      anthropicMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const content: any[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || "{}"),
          });
        }
      }
      anthropicMessages.push({ role: "assistant", content });
    } else if (msg.role === "tool") {
      anthropicMessages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        }],
      });
    }
  }

  const anthropicTools = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemMsg?.content,
      messages: anthropicMessages,
      ...(anthropicTools.length > 0 && { tools: anthropicTools }),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;

  // Convert Anthropic response → OpenAI ChatMessage format
  const textParts = (data.content ?? []).filter((b: any) => b.type === "text");
  const toolUses = (data.content ?? []).filter((b: any) => b.type === "tool_use");

  const result: ChatMessage = {
    role: "assistant",
    content: textParts.map((b: any) => b.text).join("") || "",
  };

  if (toolUses.length > 0) {
    result.tool_calls = toolUses.map((tu: any) => ({
      id: tu.id,
      type: "function" as const,
      function: {
        name: tu.name,
        arguments: JSON.stringify(tu.input ?? {}),
      },
    }));
  }

  return result;
}

// --- Gemini ---

async function geminiChatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  tools: LlmTool[],
): Promise<ChatMessage> {
  const model = config.model ?? DEFAULT_MODELS.google;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  // Gemini requires alphanumeric tool names — build index maps
  const nameMap = new Map<string, string>();    // tool_N → original
  const reverseMap = new Map<string, string>(); // original → tool_N
  tools.forEach((t, i) => {
    const geminiName = `tool_${i}`;
    nameMap.set(geminiName, t.function.name);
    reverseMap.set(t.function.name, geminiName);
  });

  // Convert conversation to Gemini format
  const contents: any[] = [];
  let systemInstruction: any = undefined;

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }

    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      const parts: any[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const geminiName = reverseMap.get(tc.function.name) ?? tc.function.name;
          parts.push({
            functionCall: {
              name: geminiName,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        }
      }
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      // Tool results → functionResponse
      const geminiName = reverseMap.get(msg.tool_call_id ?? "") ?? (msg.tool_call_id ?? "unknown");
      contents.push({
        role: "function",
        parts: [{
          functionResponse: {
            name: geminiName,
            response: { content: msg.content },
          },
        }],
      });
    }
  }

  // Convert tools to Gemini function declarations with indexed names
  const geminiTools: any[] = [];
  if (tools.length > 0) {
    geminiTools.push({
      functionDeclarations: tools.map((t, i) => ({
        name: `tool_${i}`,
        description: `[${t.function.name}] ${t.function.description}`,
        parameters: convertSchemaForGemini(t.function.parameters),
      })),
    });
  }

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (geminiTools.length > 0) body.tools = geminiTools;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error("No response from Gemini");
  }

  const parts = candidate.content.parts;
  const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
  const functionCalls = parts.filter((p: any) => p.functionCall);

  const result: ChatMessage = {
    role: "assistant",
    content: textParts.join("") || "",
  };

  if (functionCalls.length > 0) {
    result.tool_calls = functionCalls.map((fc: any) => {
      const originalName = nameMap.get(fc.functionCall.name) ?? fc.functionCall.name;
      return {
        id: originalName,
        type: "function" as const,
        function: {
          name: originalName,
          arguments: JSON.stringify(fc.functionCall.args ?? {}),
        },
      };
    });
  }

  return result;
}

function convertSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type ?? "object" };
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
      props[key] = { type: val.type ?? "string", description: val.description };
      if (val.enum) props[key] = { ...(props[key] as any), enum: val.enum };
    }
    result.properties = props;
  }
  if (schema.required) result.required = schema.required;
  return result;
}
