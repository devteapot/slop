import type { LlmProfile } from "./profiles";
import type { ChatMessage, LlmTool } from "./tools";

export async function chatCompletion(
  profile: LlmProfile,
  messages: ChatMessage[],
  tools: LlmTool[]
): Promise<ChatMessage> {
  if (profile.llmProvider === "gemini") {
    return geminiChatCompletion(profile, messages, tools);
  }
  return openaiChatCompletion(profile, messages, tools);
}

// --- OpenAI-compatible (Ollama, OpenAI, OpenRouter) ---

async function openaiChatCompletion(
  profile: LlmProfile,
  messages: ChatMessage[],
  tools: LlmTool[]
): Promise<ChatMessage> {
  const endpoint = profile.llmProvider === "openrouter"
    ? "https://openrouter.ai/api"
    : profile.endpoint;
  const url = `${endpoint}/v1/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (profile.apiKey) {
    headers["Authorization"] = `Bearer ${profile.apiKey}`;
  }
  if (profile.llmProvider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/anthropics/slop";
    headers["X-Title"] = "SLOP Desktop";
  }

  const body: Record<string, unknown> = {
    model: profile.model,
    messages,
    stream: false,
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return data.choices[0].message;
}

// --- Gemini ---

async function geminiChatCompletion(
  profile: LlmProfile,
  messages: ChatMessage[],
  tools: LlmTool[]
): Promise<ChatMessage> {
  const baseUrl = profile.endpoint || "https://generativelanguage.googleapis.com";
  const url = `${baseUrl}/v1beta/models/${profile.model}:generateContent?key=${profile.apiKey}`;

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
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        }
      }
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      contents.push({
        role: "function",
        parts: [{
          functionResponse: {
            name: msg.tool_call_id ?? "unknown",
            response: { content: msg.content },
          },
        }],
      });
    }
  }

  const geminiTools: any[] = [];
  if (tools.length > 0) {
    geminiTools.push({
      functionDeclarations: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
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
    throw new Error(`Gemini error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as any;
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
    result.tool_calls = functionCalls.map((fc: any) => ({
      id: fc.functionCall.name,
      type: "function" as const,
      function: {
        name: fc.functionCall.name,
        arguments: JSON.stringify(fc.functionCall.args ?? {}),
      },
    }));
  }

  return result;
}

function convertSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type ?? "object" };
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
      props[key] = { type: val.type ?? "string", description: val.description };
      if (val.enum) props[key] = { ...props[key] as any, enum: val.enum };
    }
    result.properties = props;
  }
  if (schema.required) result.required = schema.required;
  return result;
}

// --- Model listing ---

export async function fetchModels(profile: LlmProfile): Promise<string[]> {
  try {
    switch (profile.llmProvider) {
      case "ollama": {
        const res = await fetch(`${profile.endpoint}/api/tags`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json() as any;
        return (data.models ?? []).map((m: any) => m.name as string);
      }
      case "openai": {
        const headers: Record<string, string> = {};
        if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
        const res = await fetch(`${profile.endpoint}/v1/models`, { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json() as any;
        return (data.data ?? []).map((m: any) => m.id as string).sort();
      }
      case "openrouter": {
        const headers: Record<string, string> = {
          "HTTP-Referer": "https://github.com/anthropics/slop",
        };
        if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
        const res = await fetch("https://openrouter.ai/api/v1/models", { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json() as any;
        return (data.data ?? []).map((m: any) => m.id as string).sort();
      }
      case "gemini": {
        const baseUrl = profile.endpoint || "https://generativelanguage.googleapis.com";
        const res = await fetch(`${baseUrl}/v1beta/models?key=${profile.apiKey}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json() as any;
        return (data.models ?? [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => (m.name as string).replace("models/", ""))
          .sort();
      }
      default:
        return [];
    }
  } catch (err: any) {
    console.error("Failed to fetch models:", err.message);
    return profile.model ? [profile.model] : [];
  }
}
