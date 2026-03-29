import { create } from "zustand";
import type { ChatMessage } from "@slop/consumer/browser";
import { affordancesToTools, formatTree, decodeTool } from "@slop/consumer/browser";
import { chatCompletion } from "../slop/llm";
import { useProviderStore } from "./use-provider-store";
import { useLlmStore } from "./use-llm-store";

const SYSTEM_PROMPT = `You are an AI assistant connected to an application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. Tool names encode the path: e.g. "invoke__todos__todo-1__toggle" means invoke the "toggle" action on the node at path "/todos/todo-1".

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

Keep responses concise.`;

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "tool-progress" | "error";
  content: string;
  timestamp: number;
}

interface ChatState {
  messages: UiMessage[];
  conversation: ChatMessage[];
  processing: boolean;

  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  addError: (message: string) => void;
}

let msgCounter = 0;
function makeId(): string {
  return `msg-${++msgCounter}-${Date.now()}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversation: [{ role: "system", content: SYSTEM_PROMPT }],
  processing: false,

  sendMessage: async (text: string) => {
    if (get().processing) return;

    const provider = useProviderStore.getState().getActiveProvider();
    if (!provider?.consumer || !provider.currentTree) return;

    set({ processing: true });

    // Add user message to UI
    set(state => ({
      messages: [...state.messages, {
        id: makeId(),
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
      }],
    }));

    try {
      const profile = useLlmStore.getState().getActiveProfile();
      const conversation = get().conversation;

      // Add user message with state context
      const stateContext = `\n\n[Current application state]\n${formatTree(provider.currentTree)}`;
      conversation.push({ role: "user", content: text + stateContext });

      let tools = affordancesToTools(provider.currentTree);
      let response = await chatCompletion(profile, conversation, tools);

      // Tool call loop
      while (response.tool_calls && response.tool_calls.length > 0) {
        conversation.push(response);

        for (const tc of response.tool_calls) {
          const { path, action } = decodeTool(tc.function.name);
          const params = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

          // Show tool progress in UI
          set(state => ({
            messages: [...state.messages, {
              id: makeId(),
              role: "tool-progress" as const,
              content: `Invoking ${action} on ${path}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`,
              timestamp: Date.now(),
            }],
          }));

          const result = await provider.consumer!.invoke(path, action, params);
          await new Promise(r => setTimeout(r, 100)); // wait for patch

          // Get updated tree
          const updatedProvider = useProviderStore.getState().getActiveProvider();
          const currentTree = updatedProvider?.currentTree ?? provider.currentTree;

          const resultStr = result.status === "ok"
            ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
            : `Error [${result.error?.code}]: ${result.error?.message}`;

          conversation.push({
            role: "tool",
            content: resultStr + "\n\n[Updated state]\n" + formatTree(currentTree),
            tool_call_id: tc.id,
          });
        }

        // Refresh tools from updated tree
        const updatedProvider = useProviderStore.getState().getActiveProvider();
        if (updatedProvider?.currentTree) {
          tools = affordancesToTools(updatedProvider.currentTree);
        }
        response = await chatCompletion(profile, conversation, tools);
      }

      // Add final assistant message
      conversation.push(response);
      set(state => ({
        conversation: [...conversation],
        messages: [...state.messages, {
          id: makeId(),
          role: "assistant" as const,
          content: response.content || "(no response)",
          timestamp: Date.now(),
        }],
      }));
    } catch (err: any) {
      set(state => ({
        messages: [...state.messages, {
          id: makeId(),
          role: "error" as const,
          content: err.message,
          timestamp: Date.now(),
        }],
      }));
    } finally {
      set({ processing: false });
    }
  },

  clearChat: () => {
    set({
      messages: [],
      conversation: [{ role: "system", content: SYSTEM_PROMPT }],
    });
  },

  addError: (message: string) => {
    set(state => ({
      messages: [...state.messages, {
        id: makeId(),
        role: "error" as const,
        content: message,
        timestamp: Date.now(),
      }],
    }));
  },
}));
