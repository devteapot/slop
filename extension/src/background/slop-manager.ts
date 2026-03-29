import type { SlopNode, PatchOp, ResultMessage, ChatMessage } from "@slop-ai/consumer/browser";
import { SlopConsumer, WebSocketClientTransport, PostMessageClientTransport, affordancesToTools, formatTree, decodeTool } from "@slop-ai/consumer/browser";
import type { BackgroundMessage, ContentMessage } from "../shared/messages";
import { chatCompletion } from "./llm";

const SYSTEM_PROMPT = `You are an AI assistant connected to a web application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. The tool description tells you what it does and which node path it acts on.

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

You are running inside a browser extension chat panel. Keep responses concise.`;

interface TabState {
  consumer: SlopConsumer;
  subscriptionId: string;
  currentTree: SlopNode | null;
  port: chrome.runtime.Port;
  conversation: ChatMessage[];
  providerName: string;
  processing: boolean;
  transport: "ws" | "postmessage";
  endpoint?: string;
  reconnecting: boolean;
}

const tabs = new Map<number, TabState>();

function sendToPort(port: chrome.runtime.Port, msg: BackgroundMessage) {
  try { port.postMessage(msg); } catch {}
}

export async function connectTab(
  tabId: number,
  port: chrome.runtime.Port,
  transport: "ws" | "postmessage",
  endpoint?: string
): Promise<void> {
  // Disconnect existing
  disconnectTab(tabId);

  sendToPort(port, { type: "connection-status", status: "connecting" });

  try {
    const clientTransport = transport === "ws"
      ? new WebSocketClientTransport(endpoint!)
      : new PostMessageClientTransport(port);

    const consumer = new SlopConsumer(clientTransport);
    const hello = await consumer.connect();

    const { id: subId, snapshot } = await consumer.subscribe("/", -1);

    // Preserve conversation across reconnects
    const existingConversation = tabs.get(tabId)?.conversation;

    const state: TabState = {
      consumer,
      subscriptionId: subId,
      currentTree: snapshot,
      port,
      conversation: existingConversation ?? [{ role: "system", content: SYSTEM_PROMPT }],
      providerName: hello.provider.name,
      processing: false,
      transport,
      endpoint,
      reconnecting: false,
    };
    tabs.set(tabId, state);

    sendToPort(port, {
      type: "connection-status",
      status: "connected",
      providerName: hello.provider.name,
    });
    pushStateUpdate(state);

    consumer.on("patch", () => {
      state.currentTree = consumer.getTree(subId);
      pushStateUpdate(state);
    });

    consumer.on("disconnect", () => {
      sendToPort(port, { type: "connection-status", status: "disconnected" });
      scheduleReconnect(tabId, port, transport, endpoint);
    });
  } catch (err: any) {
    sendToPort(port, { type: "connection-status", status: "disconnected" });
    // Retry on connection failure too
    scheduleReconnect(tabId, port, transport, endpoint);
  }
}

export function disconnectTab(tabId: number): void {
  cancelReconnect(tabId);
  const state = tabs.get(tabId);
  if (state) {
    state.consumer.disconnect();
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
  transport: "ws" | "postmessage",
  endpoint?: string
): void {
  // Don't reconnect if tab was explicitly disconnected
  const existing = reconnectTimers.get(tabId);
  if (existing) clearTimeout(existing);

  const attempt = (reconnectAttempts.get(tabId) ?? 0) + 1;
  reconnectAttempts.set(tabId, attempt);

  // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_RECONNECT_DELAY);

  const timer = setTimeout(async () => {
    reconnectTimers.delete(tabId);
    try {
      await connectTab(tabId, port, transport, endpoint);
      reconnectAttempts.delete(tabId); // reset on success
    } catch {
      // connectTab already schedules another reconnect on failure
    }
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
  if (!state || !state.currentTree) {
    return;
  }
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

        const result = await state.consumer.invoke(path, action, params);
        await new Promise(r => setTimeout(r, 100)); // wait for patch

        const resultStr = result.status === "ok"
          ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
          : `Error [${result.error?.code}]: ${result.error?.message}`;

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
