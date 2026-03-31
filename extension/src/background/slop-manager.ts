import type { SlopNode, ChatMessage } from "@slop-ai/consumer/browser";
import {
  SlopConsumer, WebSocketClientTransport, PostMessageClientTransport,
  affordancesToTools, formatTree, decodeTool,
} from "@slop-ai/consumer/browser";
import type { BackgroundMessage } from "../shared/messages";
import { chatCompletion } from "./llm";

const SYSTEM_PROMPT = `You are an AI assistant connected to a web application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. The tool description tells you what it does and which node path it acts on.

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

You are running inside a browser extension chat panel. Keep responses concise.`;

interface ProviderEntry {
  name: string;                      // "data" for ws, "ui" for postmessage
  transport: "ws" | "postmessage";
  endpoint?: string;
  consumer: SlopConsumer | null;
  subscriptionId: string | null;
  tree: SlopNode | null;
  status: "disconnected" | "connecting" | "connected";
}

interface TabState {
  providers: ProviderEntry[];
  port: chrome.runtime.Port;
  conversation: ChatMessage[];
  providerName: string;
  processing: boolean;
}

const tabs = new Map<number, TabState>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sendToPort(port: chrome.runtime.Port, msg: BackgroundMessage) {
  try { port.postMessage(msg); } catch {}
}

// --- Public API ---

export async function connectTab(
  tabId: number,
  port: chrome.runtime.Port,
  discoveries: Array<{ transport: "ws" | "postmessage"; endpoint?: string }>
): Promise<void> {
  // Clean up existing tab state
  disconnectTab(tabId);

  const providerEntries: ProviderEntry[] = discoveries.map((d) => ({
    name: d.transport === "ws" ? "data" : "ui",
    transport: d.transport,
    endpoint: d.endpoint,
    consumer: null,
    subscriptionId: null,
    tree: null,
    status: "disconnected" as const,
  }));

  const state: TabState = {
    providers: providerEntries,
    port,
    conversation: [{ role: "system", content: SYSTEM_PROMPT }],
    providerName: "",
    processing: false,
  };
  tabs.set(tabId, state);

  sendToPort(port, { type: "connection-status", status: "connecting" });

  // Connect each provider independently
  for (const entry of providerEntries) {
    connectProvider(tabId, entry);
  }
}

export function disconnectTab(tabId: number): void {
  const state = tabs.get(tabId);
  if (!state) return;

  for (const entry of state.providers) {
    if (entry.consumer) {
      entry.consumer.disconnect();
      entry.consumer = null;
    }
    cancelReconnect(tabId, entry.name);
  }
  tabs.delete(tabId);
}

export async function handleUserMessage(tabId: number, text: string): Promise<void> {
  const state = tabs.get(tabId);
  if (!state || state.processing) return;

  const mergedTree = getMergedTree(state);
  if (!mergedTree) return;

  state.processing = true;

  try {
    const stateContext = `\n\n[Current application state]\n${formatTree(mergedTree)}`;
    state.conversation.push({ role: "user", content: text + stateContext });

    let tools = affordancesToTools(mergedTree);
    let response = await chatCompletion(state.conversation, tools);

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

        // Route to the correct provider
        const { consumer, providerName } = routeInvoke(state, path);
        if (!consumer) {
          state.conversation.push({
            role: "tool",
            content: `Error: no connected provider for path ${path}`,
            tool_call_id: tc.id,
          });
          continue;
        }

        const result = await consumer.invoke(path, action, params);
        await new Promise(r => setTimeout(r, 150));

        // Auto-refresh: if data action succeeded, trigger refresh on UI provider
        if (result.status === "ok" && providerName === "data") {
          const uiProvider = state.providers.find(p => p.name === "ui" && p.consumer);
          if (uiProvider?.consumer) {
            try {
              await uiProvider.consumer.invoke("/__adapter", "refresh");
              await new Promise(r => setTimeout(r, 200));
            } catch {}
          }
        }

        // Update merged tree
        const updatedTree = getMergedTree(state);
        const resultStr = result.status === "ok"
          ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
          : `Error [${result.error?.code}]: ${result.error?.message}`;

        state.conversation.push({
          role: "tool",
          content: resultStr + "\n\n[Updated state]\n" + (updatedTree ? formatTree(updatedTree) : "(no tree)"),
          tool_call_id: tc.id,
        });
      }

      const refreshedTree = getMergedTree(state);
      if (refreshedTree) {
        tools = affordancesToTools(refreshedTree);
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

export function hasTabSession(tabId: number): boolean {
  return tabs.has(tabId);
}

export function getTabMergedTree(tabId: number): SlopNode | null {
  const state = tabs.get(tabId);
  return state ? getMergedTree(state) : null;
}

export async function syncTabDiscoveries(
  tabId: number,
  discoveries: Array<{ transport: "ws" | "postmessage"; endpoint?: string }>
): Promise<void> {
  const state = tabs.get(tabId);
  if (!state) return;

  const keyForDiscovery = (discovery: { transport: "ws" | "postmessage"; endpoint?: string }) =>
    `${discovery.transport}:${discovery.endpoint ?? ""}`;
  const keyForEntry = (entry: ProviderEntry) =>
    `${entry.transport}:${entry.endpoint ?? ""}`;

  const nextKeys = new Set(discoveries.map(keyForDiscovery));

  for (const entry of [...state.providers]) {
    if (nextKeys.has(keyForEntry(entry))) continue;

    if (entry.consumer) {
      entry.consumer.disconnect();
      entry.consumer = null;
    }
    cancelReconnect(tabId, entry.name);
    state.providers = state.providers.filter((candidate) => candidate !== entry);
  }

  for (const discovery of discoveries) {
    const existing = state.providers.find((entry) => keyForEntry(entry) === keyForDiscovery(discovery));
    if (existing) continue;

    const entry: ProviderEntry = {
      name: discovery.transport === "ws" ? "data" : "ui",
      transport: discovery.transport,
      endpoint: discovery.endpoint,
      consumer: null,
      subscriptionId: null,
      tree: null,
      status: "disconnected",
    };

    state.providers.push(entry);
    void connectProvider(tabId, entry);
  }

  updateTabStatus(tabId, state);
}

export function getTabConnectionStatus(tabId: number): "disconnected" | "connecting" | "connected" {
  const state = tabs.get(tabId);
  if (!state) return "disconnected";

  const anyConnected = state.providers.some((provider) => provider.status === "connected");
  const anyConnecting = state.providers.some((provider) => provider.status === "connecting");
  return anyConnected ? "connected" : anyConnecting ? "connecting" : "disconnected";
}

// --- Internal: per-provider connection ---

async function connectProvider(tabId: number, entry: ProviderEntry): Promise<void> {
  const state = tabs.get(tabId);
  if (!state) return;

  entry.status = "connecting";

  try {
    const transport = entry.transport === "ws"
      ? new WebSocketClientTransport(entry.endpoint!)
      : new PostMessageClientTransport(state.port);

    const consumer = new SlopConsumer(transport);
    const hello = await consumer.connect();
    const { id: subId, snapshot } = await consumer.subscribe("/", -1);

    entry.consumer = consumer;
    entry.subscriptionId = subId;
    entry.tree = snapshot;
    entry.status = "connected";

    // Update tab name from first connected provider
    if (!state.providerName) {
      state.providerName = hello.provider.name;
    }

    // Notify UI
    updateTabStatus(tabId, state);

    consumer.on("patch", () => {
      entry.tree = consumer.getTree(subId);
      pushStateUpdate(tabId, state);
    });

    consumer.on("disconnect", () => {
      entry.status = "disconnected";
      entry.consumer = null;
      entry.subscriptionId = null;
      updateTabStatus(tabId, state);
      scheduleReconnect(tabId, entry);
    });
  } catch (err) {
    entry.status = "disconnected";
    updateTabStatus(tabId, state);
    scheduleReconnect(tabId, entry);
  }
}

// --- Internal: tree merging ---

function getMergedTree(state: TabState): SlopNode | null {
  const connectedTrees = state.providers
    .filter(p => p.tree && p.status === "connected")
    .map(p => ({ ...p.tree!, id: p.name }));

  if (connectedTrees.length === 0) return null;
  if (connectedTrees.length === 1) return connectedTrees[0];

  return {
    id: "root",
    type: "root",
    children: connectedTrees,
  };
}

function routeInvoke(state: TabState, path: string): { consumer: SlopConsumer | null; providerName: string } {
  // If only one connected provider, route there
  const connected = state.providers.filter(p => p.consumer && p.status === "connected");
  if (connected.length === 1) {
    return { consumer: connected[0].consumer, providerName: connected[0].name };
  }

  // Multi-provider: first path segment is the provider name ("data" or "ui")
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const firstSeg = clean.split("/")[0];
  const match = connected.find(p => p.name === firstSeg);
  if (match) {
    return { consumer: match.consumer, providerName: match.name };
  }

  // Fallback: try first connected
  return { consumer: connected[0]?.consumer ?? null, providerName: connected[0]?.name ?? "" };
}

// --- Internal: status updates ---

function updateTabStatus(tabId: number, state: TabState): void {
  const anyConnected = state.providers.some(p => p.status === "connected");
  const anyConnecting = state.providers.some(p => p.status === "connecting");
  const status = anyConnected ? "connected" : anyConnecting ? "connecting" : "disconnected";

  sendToPort(state.port, {
    type: "connection-status",
    status,
    providerName: state.providerName,
  });

  if (anyConnected) {
    pushStateUpdate(tabId, state);
  }
}

function pushStateUpdate(tabId: number, state: TabState): void {
  const tree = getMergedTree(state);
  if (!tree) return;
  sendToPort(state.port, {
    type: "state-update",
    formattedTree: formatTree(tree),
    toolCount: affordancesToTools(tree).length,
  });
}

// --- Internal: reconnection ---

function scheduleReconnect(tabId: number, entry: ProviderEntry): void {
  const key = `${tabId}-${entry.name}`;
  cancelReconnect(tabId, entry.name);

  const timer = setTimeout(() => {
    reconnectTimers.delete(key);
    const state = tabs.get(tabId);
    if (state && entry.status === "disconnected") {
      connectProvider(tabId, entry);
    }
  }, 2000);

  reconnectTimers.set(key, timer);
}

function cancelReconnect(tabId: number, name: string): void {
  const key = `${tabId}-${name}`;
  const timer = reconnectTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(key);
  }
}
