import type { SlopNode, PatchOp, ResultMessage, ChatMessage } from "@slop-ai/consumer/browser";
import {
  SlopConsumer, SlopMultiConsumer,
  WebSocketClientTransport, PostMessageClientTransport,
  affordancesToTools, formatTree, decodeTool,
} from "@slop-ai/consumer/browser";
import type { BackgroundMessage, ContentMessage } from "../shared/messages";
import { chatCompletion } from "./llm";

const SYSTEM_PROMPT = `You are an AI assistant connected to a web application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. The tool description tells you what it does and which node path it acts on.

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

You are running inside a browser extension chat panel. Keep responses concise.`;

interface ProviderInfo {
  transport: "ws" | "postmessage";
  endpoint?: string;
  name: string; // "data" for ws, "ui" for postmessage
}

interface TabState {
  multi: SlopMultiConsumer;
  currentTree: SlopNode | null;
  port: chrome.runtime.Port;
  conversation: ChatMessage[];
  providerName: string;
  providers: ProviderInfo[];
  processing: boolean;
  reconnecting: boolean;
}

const tabs = new Map<number, TabState>();

function sendToPort(port: chrome.runtime.Port, msg: BackgroundMessage) {
  try { port.postMessage(msg); } catch {}
}

/**
 * Connect to all discovered providers for a tab.
 * If already connected, only adds new providers (doesn't tear down existing).
 */
export async function connectTab(
  tabId: number,
  port: chrome.runtime.Port,
  providers: Array<{ transport: "ws" | "postmessage"; endpoint?: string }>
): Promise<void> {
  let state = tabs.get(tabId);

  // If already connected, check if there are new providers to add
  if (state) {
    const existingNames = new Set(state.providers.map((p) => p.name));
    const newProviders = providers.filter((p) => {
      const name = p.transport === "ws" ? "data" : "ui";
      return !existingNames.has(name);
    });

    if (newProviders.length === 0) return; // nothing new

    // Add new providers to existing SlopMultiConsumer
    for (const p of newProviders) {
      const name = p.transport === "ws" ? "data" : "ui";
      try {
        const transport = p.transport === "ws"
          ? new WebSocketClientTransport(p.endpoint!)
          : new PostMessageClientTransport(port);
        await state.multi.add(name, transport);
        state.providers.push({ transport: p.transport, endpoint: p.endpoint, name });
      } catch {}
    }

    state.currentTree = state.multi.tree();
    pushStateUpdate(state);
    return;
  }

  // First connection for this tab
  sendToPort(port, { type: "connection-status", status: "connecting" });

  const multi = new SlopMultiConsumer();
  const providerInfos: ProviderInfo[] = [];

  state = {
    multi,
    currentTree: null,
    port,
    conversation: [{ role: "system", content: SYSTEM_PROMPT }],
    providerName: "",
    providers: providerInfos,
    processing: false,
    reconnecting: false,
  };
  tabs.set(tabId, state);

  try {
    for (const p of providers) {
      const name = p.transport === "ws" ? "data" : "ui";
      const transport = p.transport === "ws"
        ? new WebSocketClientTransport(p.endpoint!)
        : new PostMessageClientTransport(port);

      await multi.add(name, transport);
      providerInfos.push({ transport: p.transport, endpoint: p.endpoint, name });
    }

    const tree = multi.tree();
    if (tree.children?.[0]) {
      state.providerName = tree.children[0].properties?.label as string ?? tree.children[0].id;
    }

    state.currentTree = tree;

    sendToPort(port, {
      type: "connection-status",
      status: "connected",
      providerName: state.providerName,
    });
    pushStateUpdate(state);

    multi.on("change", () => {
      state!.currentTree = multi.tree();
      pushStateUpdate(state!);
    });

    multi.on("disconnect", (providerName: string) => {
      if (multi.providerNames().length === 0) {
        sendToPort(port, { type: "connection-status", status: "disconnected" });
        scheduleReconnect(tabId, port, providers);
      }
    });
  } catch (err: any) {
    sendToPort(port, { type: "connection-status", status: "disconnected" });
    scheduleReconnect(tabId, port, providers);
  }
}

export function disconnectTab(tabId: number): void {
  cancelReconnect(tabId);
  const state = tabs.get(tabId);
  if (state) {
    state.multi.disconnect();
    tabs.delete(tabId);
  }
}

// --- Reconnection with exponential backoff ---

const reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<number, number>();
const MAX_RECONNECT_DELAY = 30000;

function scheduleReconnect(
  tabId: number,
  port: chrome.runtime.Port,
  providers: Array<{ transport: "ws" | "postmessage"; endpoint?: string }>
): void {
  const existing = reconnectTimers.get(tabId);
  if (existing) clearTimeout(existing);

  const attempt = (reconnectAttempts.get(tabId) ?? 0) + 1;
  reconnectAttempts.set(tabId, attempt);

  const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_RECONNECT_DELAY);

  const timer = setTimeout(async () => {
    reconnectTimers.delete(tabId);
    try {
      await connectTab(tabId, port, providers);
      reconnectAttempts.delete(tabId);
    } catch {}
  }, delay);

  reconnectTimers.set(tabId, timer);
}

function cancelReconnect(tabId: number): void {
  const timer = reconnectTimers.get(tabId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(tabId);
  reconnectAttempts.delete(tabId);
}

function pushStateUpdate(state: TabState): void {
  if (!state.currentTree) return;
  sendToPort(state.port, {
    type: "state-update",
    formattedTree: formatTree(state.currentTree),
    toolCount: affordancesToTools(state.currentTree).length,
  });
}

export async function handleUserMessage(tabId: number, text: string): Promise<void> {
  const state = tabs.get(tabId);
  if (!state || !state.currentTree) return;
  if (state.processing) return;
  state.processing = true;

  try {
    const stateContext = `\n\n[Current application state]\n${formatTree(state.currentTree)}`;
    state.conversation.push({ role: "user", content: text + stateContext });

    let tools = affordancesToTools(state.currentTree);
    let response = await chatCompletion(state.conversation, tools);

    // Tool call loop
    while (response.tool_calls && response.tool_calls.length > 0) {
      state.conversation.push(response);

      for (const tc of response.tool_calls) {
        const { path, action } = decodeTool(tc.function.name);
        const params = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

        sendToPort(state.port, {
          type: "chat-message",
          role: "tool-progress",
          content: `Invoking ${action} on ${path}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`,
        });

        // Route to correct provider via SlopMultiConsumer
        const result = await state.multi.invoke(path, action, params);
        await new Promise(r => setTimeout(r, 100)); // wait for patch

        // Auto-refresh: if this was a data action, trigger refresh on UI provider
        if (result.status !== "error" && state.providers.length > 1) {
          try {
            await state.multi.invoke("/ui/__adapter", "refresh");
            await new Promise(r => setTimeout(r, 200)); // wait for UI to re-fetch
          } catch {}
        }

        const resultStr = result.status === "ok"
          ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
          : `Error [${(result as any).error?.code}]: ${(result as any).error?.message}`;

        state.currentTree = state.multi.tree();

        state.conversation.push({
          role: "tool",
          content: resultStr + "\n\n[Updated state]\n" + formatTree(state.currentTree!),
          tool_call_id: tc.id,
        });
      }

      // Refresh tools from updated tree
      if (state.currentTree) {
        tools = affordancesToTools(state.currentTree);
      }
      response = await chatCompletion(state.conversation, tools);
    }

    state.conversation.push(response);
    sendToPort(state.port, { type: "chat-message", role: "assistant", content: response.content });
    sendToPort(state.port, { type: "chat-done" });
  } catch (err: any) {
    sendToPort(state.port, { type: "chat-error", message: err.message });
  } finally {
    state.processing = false;
  }
}

export function getTabState(tabId: number): TabState | undefined {
  return tabs.get(tabId);
}
