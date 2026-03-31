/**
 * AI agent using direct SLOP protocol messages via the in-memory transport.
 *
 * Architecture decision: we use the InMemoryTransport directly instead of the
 * SlopConsumer class. SlopConsumer.connect() is designed for network transports
 * where the connection handshake is event-driven (WebSocket open → server sends
 * hello). In the in-memory case, messages are delivered synchronously, which
 * causes the hello to arrive before the consumer's onMessage handler is set up.
 * Rather than hack around the timing, the ProtocolClient below sends the same
 * SLOP protocol messages (connect, subscribe, invoke) directly through the
 * transport, keeping the message format identical to what a real consumer sends.
 *
 * The 150ms delay after invoke is a React rendering constraint (see slop.ts),
 * not a protocol deviation — server-side providers don't need it.
 */

import { affordancesToTools, formatTree, decodeTool } from "@slop-ai/consumer/browser";
import type { ChatMessage, LlmTool, SlopNode } from "@slop-ai/consumer/browser";
import { transport } from "../slop";
import { chatCompletion, type LLMConfig } from "./provider";
import type { DemoContextValue } from "../context";
import { createMessageId } from "../context";

const SYSTEM_PROMPT = `You are an AI assistant connected to a web application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. The tool description tells you what it does and which node path it acts on.

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

Tools marked [DANGEROUS] are destructive or irreversible (e.g. clearing the cart, deleting items). ALWAYS ask the user for confirmation before calling a dangerous tool. Never call a dangerous tool without explicit user approval.

Keep responses concise.`;

const MAX_TOOL_ROUNDS = 5;

/**
 * Thin protocol client that talks to the provider via the in-memory transport.
 * Synchronous setup — no async connect, no timing issues.
 */
class ProtocolClient {
  private tree: SlopNode | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private counter = 0;

  connect() {
    transport.onProviderMessage((msg: any) => {
      // Initial snapshot from our subscription
      if (msg.type === "snapshot" && msg.id === "agent-sub") {
        this.tree = msg.tree;
      }
      // Patches → re-query for fresh tree
      if (msg.type === "patch" && msg.subscription === "agent-sub") {
        const refreshId = `agent-refresh-${++this.counter}`;
        transport.sendToProvider({ type: "query", id: refreshId, path: "/", depth: -1 });
      }
      // Fresh tree from re-query
      if (msg.type === "snapshot" && msg.id?.startsWith("agent-refresh-")) {
        this.tree = msg.tree;
      }
      // Invoke results
      if (msg.type === "result" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    });

    // Subscribe — these fire synchronously, responses arrive through the listener above
    transport.sendToProvider({ type: "connect" });
    transport.sendToProvider({ type: "subscribe", id: "agent-sub", path: "/", depth: -1 });
  }

  getTree(): SlopNode | null {
    return this.tree;
  }

  async invoke(path: string, action: string, params?: Record<string, unknown>): Promise<any> {
    const id = `agent-inv-${++this.counter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      transport.sendToProvider({ type: "invoke", id, path, action, params });
    });
  }
}

// Shared client — created once, reused across turns
let client: ProtocolClient | null = null;

function ensureClient(): ProtocolClient {
  if (!client) {
    client = new ProtocolClient();
    client.connect();
  }
  return client;
}

export async function runAgentTurn(
  userMessage: string,
  context: Pick<DemoContextValue, "addMessage" | "updateMessage" | "setStatus" | "apiKey" | "apiProvider" | "apiModel">,
) {
  const config: LLMConfig = {
    provider: context.apiProvider as LLMConfig["provider"],
    apiKey: context.apiKey,
    model: context.apiModel || undefined,
  };

  const c = ensureClient();
  const tree = c.getTree();
  if (!tree) throw new Error("No tree available from provider");

  // Build conversation — append state context to user message (same as extension)
  const stateContext = `\n\n[Current application state]\n${formatTree(tree)}`;
  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage + stateContext },
  ];

  let tools: LlmTool[] = affordancesToTools(tree);
  context.setStatus({ state: "observing", label: "AI thinking..." });
  let response = await chatCompletion(config, conversation, tools);

  // Tool call loop
  let round = 0;
  while (response.tool_calls?.length && round < MAX_TOOL_ROUNDS) {
    round++;
    conversation.push(response);

    for (const tc of response.tool_calls) {
      const { path, action } = decodeTool(tc.function.name);
      const params = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

      context.setStatus({ state: "acting", label: `Invoking ${action} on ${path}` });
      context.addMessage({
        id: createMessageId(),
        role: "assistant",
        content: "",
        toolCalls: [{ path, action, params }],
      });

      context.setStatus({ state: "updating", label: "State updating..." });
      const result = await c.invoke(path, action, params);

      // Wait for React to re-render → useSlop to re-register → provider to
      // rebuild and broadcast patches → ProtocolClient to re-query fresh tree.
      // Server-side providers rebuild synchronously; this delay is React-specific.
      await new Promise((r) => setTimeout(r, 150));

      const resultStr = result.status === "ok"
        ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
        : `Error [${result.error?.code}]: ${result.error?.message}`;

      conversation.push({
        role: "tool",
        content: resultStr,
        tool_call_id: tc.id,
      });
    }

    // Refresh tools from updated tree
    const updatedTree = c.getTree();
    if (updatedTree) {
      tools = affordancesToTools(updatedTree);
    }

    context.setStatus({ state: "observing", label: "AI thinking..." });
    response = await chatCompletion(config, conversation, tools);
  }

  // Final text response
  conversation.push(response);
  if (response.content) {
    context.addMessage({
      id: createMessageId(),
      role: "assistant",
      content: response.content,
    });
  }

  context.setStatus({ state: "idle", label: "Ready" });
}
