import type { SlopMessage, SlopNode } from "./types";

// Content script → Background
export type ContentMessage =
  | { type: "slop-discovered"; transport: "ws" | "postmessage"; endpoint?: string }
  | { type: "slop-lost" }
  | { type: "user-message"; text: string }
  | { type: "get-state" }
  | { type: "get-status" }
  | { type: "slop-from-provider"; message: SlopMessage };

// Background → Content script
export type BackgroundMessage =
  | { type: "connection-status"; status: "disconnected" | "connecting" | "connected"; providerName?: string }
  | { type: "state-update"; formattedTree: string; toolCount: number }
  | { type: "chat-message"; role: "assistant" | "tool-progress"; content: string }
  | { type: "chat-done" }
  | { type: "chat-error"; message: string }
  | { type: "slop-to-provider"; message: SlopMessage };

// Settings
export interface SlopSettings {
  llmProvider: "ollama" | "openai";
  endpoint: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_SETTINGS: SlopSettings = {
  llmProvider: "ollama",
  endpoint: "http://localhost:11434",
  apiKey: "",
  model: "qwen2.5:14b",
};
