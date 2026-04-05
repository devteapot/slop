import type { ChatMessage } from "@slop-ai/consumer/browser";
import type { BackgroundMessage } from "../types";
import type { Session } from "./session";
import { buildMergedContext, type ProviderTreeInfo } from "./tool-router";
import { chatCompletion } from "./llm";

const SYSTEM_PROMPT = `You are an AI assistant connected to a web application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. The tool description tells you what it does and which node path it acts on.

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

You are running inside a browser extension chat panel. Keep responses concise.`;

function send(port: chrome.runtime.Port, msg: BackgroundMessage) {
  try {
    port.postMessage(msg);
  } catch (e) {
    console.warn("[slop] failed to post chat update:", e);
  }
}

export async function runTurn(
  session: Session,
  conversation: ChatMessage[],
  port: chrome.runtime.Port,
  text: string,
): Promise<void> {
  const mergedTree = session.getMergedTree();
  if (!mergedTree) return;

  // Build context from connected providers
  const providerInfos: ProviderTreeInfo[] = session.getConnectedProviders().map(({ entry, index }) => ({
    name: entry.name,
    index,
    tree: entry.tree!,
  }));

  if (providerInfos.length === 0) return;

  const merged = buildMergedContext(providerInfos);

  // Add user message with state context
  conversation.push({
    role: "user",
    content: text + `\n\n[Current application state]\n${merged.stateStr}`,
  });

  // Tools fixed for entire turn
  const tools = merged.tools;

  try {
    let response = await chatCompletion(conversation, tools);

    while (response.tool_calls && response.tool_calls.length > 0) {
      conversation.push(response);

      for (const tc of response.tool_calls) {
        const route = merged.resolve(tc.function.name);

        if (!route) {
          conversation.push({
            role: "tool",
            content: `Error: Unknown tool ${tc.function.name}`,
            tool_call_id: tc.id,
          });
          continue;
        }

        const { providerIndex, path, action, targets } = route;
        const params = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

        // For grouped tools (path is null), extract target from params
        const invokePath = path ?? params.target as string | undefined;
        if (!invokePath) {
          conversation.push({
            role: "tool",
            content: `Error: grouped tool "${tc.function.name}" requires a target parameter`,
            tool_call_id: tc.id,
          });
          continue;
        }

        // Emit progress
        const paramsStr = Object.keys(params).length ? " " + JSON.stringify(params) : "";
        send(port, { type: "progress", content: `Invoking ${action} on ${invokePath}${paramsStr}` });

        // Execute invocation
        const entry = session.getProviderByIndex(providerIndex);
        if (!entry?.consumer) {
          conversation.push({
            role: "tool",
            content: `Error: provider not connected`,
            tool_call_id: tc.id,
          });
          continue;
        }

        try {
          const result = await entry.consumer.invoke(invokePath, action, params);
          await new Promise(r => setTimeout(r, 150));

          const resultStr = result.status === "ok"
            ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
            : `Error [${result.error?.code}]: ${result.error?.message}`;

          conversation.push({ role: "tool", content: resultStr, tool_call_id: tc.id });
        } catch (err: unknown) {
          conversation.push({
            role: "tool",
            content: `Error: ${getErrorMessage(err)}`,
            tool_call_id: tc.id,
          });
        }
      }

      // Continue with SAME tools (fixed per turn)
      response = await chatCompletion(conversation, tools);
    }

    conversation.push(response);
    send(port, { type: "assistant", content: response.content || "(no response)" });
    send(port, { type: "input-ready" });
  } catch (err: unknown) {
    send(port, { type: "error", message: getErrorMessage(err) });
    send(port, { type: "input-ready" });
  }
}

export function initConversation(): ChatMessage[] {
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
