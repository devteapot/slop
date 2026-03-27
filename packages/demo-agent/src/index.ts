import type { SlopNode, Affordance, ResultMessage } from "@slop/types";
import {
  SlopConsumer,
  UnixClientTransport,
  findProvider,
  listProviders,
  transportForDescriptor,
} from "@slop/consumer";
import { createInterface } from "node:readline";

// --- Ollama config ---
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

// --- SLOP → LLM tool conversion ---

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Walk the state tree and collect all affordances as LLM tools.
 * Tool names encode the path: "invoke__todos__todo-1__toggle"
 */
function affordancesToTools(node: SlopNode, path: string = ""): OllamaTool[] {
  const tools: OllamaTool[] = [];

  for (const aff of node.affordances ?? []) {
    const toolName = encodeTool(path || "/", aff.action);
    tools.push({
      type: "function",
      function: {
        name: toolName,
        description:
          `${aff.label ?? aff.action}${aff.description ? ": " + aff.description : ""}` +
          ` (on ${path || "/"})` +
          (aff.dangerous ? " [DANGEROUS - confirm first]" : ""),
        parameters: aff.params
          ? aff.params
          : { type: "object", properties: {} },
      },
    });
  }

  for (const child of node.children ?? []) {
    const childPath = `${path}/${child.id}`;
    tools.push(...affordancesToTools(child, childPath));
  }

  return tools;
}

function encodeTool(path: string, action: string): string {
  // "/ " + "add_todo" → "invoke____add_todo"
  // "/todos/todo-1" + "toggle" → "invoke__todos__todo-1__toggle"
  const segments = path.split("/").filter(Boolean);
  return ["invoke", ...segments, action].join("__");
}

function decodeTool(name: string): { path: string; action: string } {
  const parts = name.split("__");
  // parts[0] is "invoke", last is action, middle is path segments
  const action = parts[parts.length - 1];
  const pathSegments = parts.slice(1, -1);
  const path = pathSegments.length > 0 ? "/" + pathSegments.join("/") : "/";
  return { path, action };
}

/** Format the state tree as a readable string for the LLM */
function formatTree(node: SlopNode, indent: number = 0): string {
  const pad = "  ".repeat(indent);
  const props = node.properties ?? {};
  const label = (props.label ?? props.title ?? node.id) as string;

  const extra = Object.entries(props)
    .filter(([k]) => k !== "label" && k !== "title")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");

  const affordances = (node.affordances ?? [])
    .map((a) => {
      let s = a.action;
      if (a.params?.properties) {
        const params = Object.entries(a.params.properties as Record<string, any>)
          .map(([k, v]) => `${k}: ${v.type}`)
          .join(", ");
        s += `(${params})`;
      }
      return s;
    })
    .join(", ");

  let line = `${pad}[${node.type}] ${label}`;
  if (extra) line += ` (${extra})`;
  if (affordances) line += `  actions: {${affordances}}`;

  const lines = [line];
  for (const child of node.children ?? []) {
    lines.push(formatTree(child, indent + 1));
  }
  return lines.join("\n");
}

// --- Ollama chat ---

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

async function chatCompletion(
  messages: ChatMessage[],
  tools: OllamaTool[]
): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    stream: false,
  };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  return data.choices[0].message;
}

// --- Main ---

async function main() {
  // Connect to SLOP provider
  const arg = process.argv[2];
  let transport;

  if (arg) {
    const desc = findProvider(arg);
    transport = desc ? transportForDescriptor(desc) : new UnixClientTransport(arg);
  } else {
    const providers = listProviders();
    if (providers.length === 0) {
      console.log("No SLOP providers found. Start one first: bun run demo");
      process.exit(1);
    }
    transport = transportForDescriptor(providers[0]);
  }

  const consumer = new SlopConsumer({ transport });
  const hello = await consumer.connect();
  console.log(`Connected to ${hello.provider.name} via SLOP\n`);

  const { id: subId, snapshot } = await consumer.subscribe("/", -1);

  // Keep tree updated
  let currentTree = snapshot;
  consumer.on("patch", (sid: string) => {
    const t = consumer.getTree(sid);
    if (t) currentTree = t;
  });

  // System prompt
  const systemPrompt = `You are an AI assistant connected to an application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. Tool names encode the path: e.g. "invoke__todos__todo-1__toggle" means invoke the "toggle" action on the node at path "/todos/todo-1".

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items. For example, if the user says "complete all tasks", call toggle on EVERY incomplete task in one response — do NOT stop after the first one.

Be concise. Act decisively when the user's intent is clear.`;

  const conversation: ChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  console.log(`Model: ${MODEL}`);
  console.log(`State tree:`);
  console.log(formatTree(currentTree));
  console.log(`\nYou can now chat with the AI. It sees the app state and can invoke actions.`);
  console.log(`Type your message, or "tree" to see current state, "quit" to exit.\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("you> ");
  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed === "quit" || trimmed === "exit") {
      consumer.disconnect();
      process.exit(0);
    }

    if (trimmed === "tree") {
      console.log("\n" + formatTree(currentTree) + "\n");
      rl.prompt();
      return;
    }

    // Inject current state into the user message
    const stateContext = `\n\n[Current application state]\n${formatTree(currentTree)}`;
    conversation.push({
      role: "user",
      content: trimmed + stateContext,
    });

    try {
      // Build tools from current state
      const tools = affordancesToTools(currentTree);

      // Chat loop: keep going while the LLM wants to call tools
      let response = await chatCompletion(conversation, tools);

      while (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls
        conversation.push(response);

        console.log();
        // Execute each tool call
        for (const tc of response.tool_calls) {
          const { path, action } = decodeTool(tc.function.name);
          const params = tc.function.arguments
            ? JSON.parse(tc.function.arguments)
            : {};

          console.log(`  -> invoke ${path} ${action}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`);

          const result = await consumer.invoke(path, action, params);

          // Wait for patch to propagate
          await new Promise((r) => setTimeout(r, 100));

          const resultStr =
            result.status === "ok"
              ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}`
              : `Error [${result.error?.code}]: ${result.error?.message}`;

          console.log(`  <- ${resultStr}`);

          // Add tool result
          conversation.push({
            role: "tool",
            content: resultStr + "\n\n[Updated state]\n" + formatTree(currentTree),
            tool_call_id: tc.id,
          });
        }

        // Continue conversation with tool results
        const updatedTools = affordancesToTools(currentTree);
        response = await chatCompletion(conversation, updatedTools);
      }

      // Final text response
      conversation.push(response);
      console.log(`\nai> ${response.content}\n`);
    } catch (err: any) {
      console.log(`\nError: ${err.message}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    consumer.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
