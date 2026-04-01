import type { LlmProfile } from "../../types";
import { getActiveProfile } from "../../types";
import { getStorage } from "./storage";

export async function fetchModels(): Promise<string[]> {
  const storage = await getStorage();
  const profile = getActiveProfile(storage);

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
          "HTTP-Referer": "https://github.com/nichochar/slop",
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
