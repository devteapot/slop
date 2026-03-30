import { create } from "zustand";
import type { ChatMessage } from "@slop-ai/consumer/browser";
import { affordancesToTools, formatTree, decodeTool } from "@slop-ai/consumer/browser";
import type { SlopNode } from "@slop-ai/consumer/browser";
import { chatCompletion } from "../slop/llm";
import { useProviderStore } from "./use-provider-store";
import { useWorkspaceStore } from "./use-workspace-store";
import { useLlmStore } from "./use-llm-store";

const SYSTEM_PROMPT = `You are an AI assistant connected to one or more applications via the SLOP protocol (State Layer for Observable Programs).

You can SEE each connected application's state as a structured tree, and you can ACT on them by calling the available tool functions.

Tool names are prefixed with the provider name to indicate which app they act on. For example:
- kanban-board__invoke__columns__backlog__add_card → acts on the Kanban Board
- project-tracker__invoke__projects__create_project → acts on the Project Tracker

When the user asks you to do something, look at all connected apps, figure out which action(s) to invoke and on which app, and call the appropriate tool(s). You can act across MULTIPLE apps in a single response.

Keep responses concise.`;

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "tool-progress" | "error";
  content: string;
  timestamp: number;
}

interface ChatState {
  processing: boolean;

  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
}

let msgCounter = 0;
function makeId(): string {
  return `msg-${++msgCounter}-${Date.now()}`;
}

/**
 * Build a merged tree and tool list from all connected providers in the active workspace.
 */
function buildMergedContext() {
  const workspace = useWorkspaceStore.getState().getActiveWorkspace();
  const allProviders = useProviderStore.getState().providers;

  const trees: { providerId: string; providerName: string; tree: SlopNode }[] = [];
  const allTools: any[] = [];

  for (const pid of workspace.providerIds) {
    const provider = allProviders.get(pid);
    if (!provider?.currentTree || provider.status !== "connected") continue;

    const name = provider.providerName ?? provider.name;
    trees.push({ providerId: pid, providerName: name, tree: provider.currentTree });

    // Prefix each tool with provider name for disambiguation
    const tools = affordancesToTools(provider.currentTree);
    for (const tool of tools) {
      allTools.push({
        ...tool,
        function: {
          ...tool.function,
          name: `${name}__${tool.function.name}`,
          description: `[${name}] ${tool.function.description}`,
        },
      });
    }
  }

  // If only one provider, skip prefixing for cleaner tool names
  if (trees.length === 1) {
    const tools = affordancesToTools(trees[0].tree);
    allTools.length = 0;
    allTools.push(...tools);
  }

  let stateStr = "";
  for (const { providerName, tree } of trees) {
    if (trees.length > 1) stateStr += `\n--- ${providerName} ---\n`;
    stateStr += formatTree(tree) + "\n";
  }

  return { trees, allTools, stateStr, singleProvider: trees.length === 1 };
}

/**
 * Route a tool call to the correct provider.
 */
function routeToolCall(toolName: string, singleProvider: boolean) {
  const workspace = useWorkspaceStore.getState().getActiveWorkspace();
  const allProviders = useProviderStore.getState().providers;

  const isConnected = (p: any) => p && p.status === "connected" && p.consumer;

  // Single provider — no prefix, route directly
  if (singleProvider) {
    for (const pid of workspace.providerIds) {
      const provider = allProviders.get(pid);
      if (!isConnected(provider)) continue;
      const { path, action } = decodeTool(toolName);
      return { provider, path, action };
    }
    return null;
  }

  // Multi-provider — strip prefix to find target
  for (const pid of workspace.providerIds) {
    const provider = allProviders.get(pid);
    if (!provider || !isConnected(provider)) continue;

    const name = provider.providerName ?? provider.name;
    const prefix = `${name}__`;
    if (toolName.startsWith(prefix)) {
      const originalName = toolName.slice(prefix.length);
      const { path, action } = decodeTool(originalName);
      return { provider, path, action };
    }
  }
  return null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  processing: false,

  sendMessage: async (text: string) => {
    if (get().processing) return;

    const workspace = useWorkspaceStore.getState().getActiveWorkspace();
    const { trees, allTools, stateStr, singleProvider } = buildMergedContext();

    if (trees.length === 0) return;

    set({ processing: true });

    const userMsg: UiMessage = { id: makeId(), role: "user", content: text, timestamp: Date.now() };
    let currentMessages = [...workspace.messages, userMsg];
    const conversation = workspace.conversation.length > 0
      ? [...workspace.conversation]
      : [{ role: "system" as const, content: SYSTEM_PROMPT }];

    useWorkspaceStore.getState().updateWorkspaceMessages(workspace.id, currentMessages, conversation);

    try {
      const profile = useLlmStore.getState().getActiveProfile();

      conversation.push({
        role: "user",
        content: text + `\n\n[Connected applications state]\n${stateStr}`,
      });

      let tools = allTools;
      let response = await chatCompletion(profile, conversation, tools);

      while (response.tool_calls && response.tool_calls.length > 0) {
        conversation.push(response);

        for (const tc of response.tool_calls) {
          const route = routeToolCall(tc.function.name, singleProvider);
          if (!route) {
            conversation.push({
              role: "tool",
              content: `Error: Unknown tool ${tc.function.name}`,
              tool_call_id: tc.id,
            });
            continue;
          }

          const { provider, path, action } = route;
          const params = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

          const progressMsg: UiMessage = {
            id: makeId(),
            role: "tool-progress",
            content: `Invoking ${action} on ${path}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`,
            timestamp: Date.now(),
          };
          currentMessages = [...currentMessages, progressMsg];
          useWorkspaceStore.getState().updateWorkspaceMessages(workspace.id, currentMessages, conversation);

          const result = await provider!.consumer!.invoke(path, action, params);
          await new Promise(r => setTimeout(r, 100));

          // Auto-refresh: if this provider has a paired UI provider (same tab), trigger refresh
          if (result.status === "ok" && provider!.bridgeTabId != null) {
            const allProviders = useProviderStore.getState().providers;
            for (const [, p] of allProviders) {
              if (p.id !== provider!.id && p.bridgeTabId === provider!.bridgeTabId
                  && p.bridgeTransport === "postmessage" && p.consumer && p.status === "connected") {
                try {
                  await p.consumer.invoke("/__adapter", "refresh");
                  await new Promise(r => setTimeout(r, 200));
                } catch {}
              }
            }
          }

          const resultStr = result.status === "ok"
            ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
            : `Error [${result.error?.code}]: ${result.error?.message}`;

          const { stateStr: updatedState } = buildMergedContext();
          conversation.push({
            role: "tool",
            content: resultStr + `\n\n[Updated state]\n${updatedState}`,
            tool_call_id: tc.id,
          });
        }

        const { allTools: refreshedTools } = buildMergedContext();
        tools = refreshedTools;
        response = await chatCompletion(profile, conversation, tools);
      }

      conversation.push(response);
      const assistantMsg: UiMessage = {
        id: makeId(),
        role: "assistant",
        content: response.content || "(no response)",
        timestamp: Date.now(),
      };
      currentMessages = [...currentMessages, assistantMsg];
      useWorkspaceStore.getState().updateWorkspaceMessages(workspace.id, currentMessages, conversation);

    } catch (err: any) {
      const errorMsg: UiMessage = {
        id: makeId(),
        role: "error",
        content: err.message,
        timestamp: Date.now(),
      };
      currentMessages = [...currentMessages, errorMsg];
      useWorkspaceStore.getState().updateWorkspaceMessages(workspace.id, currentMessages, conversation);
    } finally {
      set({ processing: false });
    }
  },

  clearChat: () => {
    const workspace = useWorkspaceStore.getState().getActiveWorkspace();
    useWorkspaceStore.getState().updateWorkspaceMessages(workspace.id, [], []);
  },
}));
