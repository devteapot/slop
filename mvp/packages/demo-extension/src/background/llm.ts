import type { SlopSettings, DEFAULT_SETTINGS } from "../shared/messages";
import type { ChatMessage, LlmTool } from "../shared/tools";

export async function getSettings(): Promise<SlopSettings> {
  const result = await chrome.storage.sync.get("settings");
  return result.settings ?? {
    llmProvider: "ollama",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "qwen2.5:14b",
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  tools: LlmTool[]
): Promise<ChatMessage> {
  const settings = await getSettings();

  const url = `${settings.endpoint}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) {
    headers["Authorization"] = `Bearer ${settings.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: settings.model,
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
