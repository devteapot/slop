import type { LlmProfile } from "../../types";
import { getActiveProfile } from "../../types";
import { getStorage } from "./storage";
import {
  parseGeminiModelNames,
  parseOllamaModelNames,
  parseOpenAIModelNames,
} from "./parsers";

export async function fetchModels(): Promise<string[]> {
  const storage = await getStorage();
  const profile = getActiveProfile(storage);

  try {
    switch (profile.llmProvider) {
      case "ollama": {
        const res = await fetch(`${profile.endpoint}/api/tags`);
        if (!res.ok) throw new Error(`${res.status}`);
        return parseOllamaModelNames(await res.json());
      }
      case "openai": {
        const headers: Record<string, string> = {};
        if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
        const res = await fetch(`${profile.endpoint}/v1/models`, { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        return parseOpenAIModelNames(await res.json()).sort();
      }
      case "openrouter": {
        const headers: Record<string, string> = {
          "HTTP-Referer": "https://github.com/nichochar/slop",
        };
        if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
        const res = await fetch("https://openrouter.ai/api/v1/models", { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        return parseOpenAIModelNames(await res.json()).sort();
      }
      case "gemini": {
        const baseUrl = profile.endpoint || "https://generativelanguage.googleapis.com";
        const res = await fetch(`${baseUrl}/v1beta/models?key=${profile.apiKey}`);
        if (!res.ok) throw new Error(`${res.status}`);
        return parseGeminiModelNames(await res.json());
      }
      default:
        return [];
    }
  } catch (err: unknown) {
    console.error("Failed to fetch models:", err instanceof Error ? err.message : err);
    return profile.model ? [profile.model] : [];
  }
}
