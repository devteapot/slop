import type { LlmProfile } from "../../types";
import type { ChatMessage, LlmTool } from "@slop-ai/consumer/browser";
import { parseChatMessage } from "./parsers";

export async function openaiChatCompletion(
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
    headers["HTTP-Referer"] = "https://github.com/nichochar/slop";
    headers["X-Title"] = "SLOP Extension";
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

  const payload = await res.json();
  if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new Error("LLM response missing choices");
  }

  const firstChoice = payload.choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) {
    throw new Error("LLM response missing first choice message");
  }

  return parseChatMessage(firstChoice.message);
}
