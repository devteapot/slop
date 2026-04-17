import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TodoStore } from "./store.ts";
import { seedTodo } from "./seed.ts";
import { startTodoSlopServer, type TodoSlopOpts } from "./slop-server.ts";
import { todoScenarios } from "./scenarios.ts";
import type { AppBinding, AppStore, McpServerHandle, SlopServerHandle } from "../registry.ts";
import type { DataScale } from "../../runner/types.ts";
import type { Scenario, VerificationResult } from "../../../mcp-vs-slop/scenarios/types.ts";

function wrap(inner: TodoStore): AppStore & { inner: TodoStore } {
  return { __brand: "app-store", inner } as AppStore & { inner: TodoStore };
}

export const todoApp: AppBinding = {
  id: "todo",
  supportedScales: ["s", "m", "l", "xl"],
  createStore(scale, seed) {
    const store = new TodoStore();
    store.reset(seedTodo(scale, seed));
    return wrap(store);
  },
  async startSlopServer(store, port, opts): Promise<SlopServerHandle> {
    const inner = (store as unknown as { inner: TodoStore }).inner;
    const { server, slop } = startTodoSlopServer(inner, port, opts as TodoSlopOpts | undefined);
    return {
      wsUrl: `ws://localhost:${port}/slop`,
      stop: async () => {
        slop.stop();
        server.stop();
      },
    };
  },
  scenarios: todoScenarios,
  verify(store, scenario) {
    if (!scenario.verify) return undefined;
    const inner = (store as unknown as { inner: TodoStore }).inner;
    return scenario.verify(inner as unknown as Parameters<NonNullable<Scenario["verify"]>>[0]);
  },
  mcpSystemPrompt:
    "You are a todo-list agent. You have tools to list tasks and mutate them. " +
    "You have no prior knowledge of the data — discover it by listing tasks. " +
    'When the task is complete, respond with "DONE".',
  async startMcpServer(scale: DataScale, _variant: string): Promise<McpServerHandle> {
    // Every variant we currently ship (flat, flat+prompt) uses the same
    // underlying stdio MCP server — only the system prompt differs, and
    // that's handled by the cell runner via resolveMcpVariant. If a future
    // variant needs a different server (resources, prompts), dispatch here.
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env.BENCH_SCALE = scale;
    env.BENCH_SEED = String(42);
    const serverPath = new URL("./mcp-server.ts", import.meta.url).pathname;
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", serverPath],
      env,
    });
    const client = new Client({ name: "slop-benchmarks-v2", version: "0.2.0" });
    await client.connect(transport);
    return {
      client,
      stop: async () => {
        await client.close();
      },
      verify: async (scenario: Scenario): Promise<VerificationResult | undefined> => {
        if (!scenario.verify) return undefined;
        // Reconstruct a TodoStore from one list_tasks call. No children to
        // recurse, so this is a single round trip.
        const res = await client.callTool({ name: "list_tasks", arguments: {} });
        const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
        const text = content.find((c) => c.type === "text")?.text ?? "[]";
        const tasks = JSON.parse(text);
        const tempStore = new TodoStore();
        tempStore.reset(tasks);
        return scenario.verify(tempStore as unknown as Parameters<NonNullable<Scenario["verify"]>>[0]);
      },
    };
  },
};
