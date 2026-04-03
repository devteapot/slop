import type { ChatMessage, LlmTool } from "@slop-ai/consumer/browser";
import { getActiveProfile } from "../../types";
import { getStorage } from "./storage";
import { openaiChatCompletion } from "./openai";
import { geminiChatCompletion } from "./gemini";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: LlmTool[]
): Promise<ChatMessage> {
  const storage = await getStorage();
  const profile = getActiveProfile(storage);

  if (profile.llmProvider === "gemini") {
    return geminiChatCompletion(profile, messages, tools);
  }
  return openaiChatCompletion(profile, messages, tools);
}

export { fetchModels } from "./models";
export { getStorage, saveStorage, setActiveModel } from "./storage";
