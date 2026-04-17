import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CrmStore } from "./store.ts";
import { seedCrm } from "./seed.ts";
import { startCrmSlopServer, type CrmSlopOpts } from "./slop-server.ts";
import { crmScenarios } from "./scenarios.ts";
import type { AppBinding, AppStore, McpServerHandle, SlopServerHandle } from "../registry.ts";
import type { DataScale } from "../../runner/types.ts";
import type { Scenario, VerificationResult } from "../../../mcp-vs-slop/scenarios/types.ts";

function wrap(inner: CrmStore): AppStore & { inner: CrmStore } {
  return { __brand: "app-store", inner } as AppStore & { inner: CrmStore };
}

export const crmApp: AppBinding = {
  id: "crm",
  supportedScales: ["s", "m", "l", "xl"],
  createStore(scale, seed) {
    const store = new CrmStore();
    const { contacts, deals, activities } = seedCrm(scale, seed);
    store.reset(contacts, deals, activities);
    return wrap(store);
  },
  async startSlopServer(store, port, opts): Promise<SlopServerHandle> {
    const inner = (store as unknown as { inner: CrmStore }).inner;
    const { server, slop } = startCrmSlopServer(inner, port, opts as CrmSlopOpts | undefined);
    return {
      wsUrl: `ws://localhost:${port}/slop`,
      stop: async () => {
        slop.stop();
        server.stop();
      },
    };
  },
  scenarios: crmScenarios,
  verify(store, scenario) {
    if (!scenario.verify) return undefined;
    const inner = (store as unknown as { inner: CrmStore }).inner;
    return scenario.verify(inner as unknown as Parameters<NonNullable<Scenario["verify"]>>[0]);
  },
  mcpSystemPrompt:
    "You are a CRM agent. You have tools to list and mutate contacts, deals, and activities. " +
    "You have no prior knowledge of the data — discover it using list_* and get_* tools. " +
    'When the task is complete, respond with "DONE".',
  async startMcpServer(scale: DataScale, _variant: string): Promise<McpServerHandle> {
    // All current MCP variants share the flat server; prompt-level variants
    // are applied by the cell runner via resolveMcpVariant.
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
        // Reconstruct by listing all three entity collections.
        const tempStore = new CrmStore();
        const [cRes, dRes, aRes] = await Promise.all([
          client.callTool({ name: "list_contacts", arguments: {} }),
          client.callTool({ name: "list_deals", arguments: {} }),
          client.callTool({ name: "list_activities", arguments: {} }),
        ]);
        tempStore.reset(parseJson(cRes), parseJson(dRes), parseJson(aRes));
        return scenario.verify(tempStore as unknown as Parameters<NonNullable<Scenario["verify"]>>[0]);
      },
    };
  },
};

function parseJson(result: unknown): any[] {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === "text")?.text ?? "[]";
  try {
    return JSON.parse(text) ?? [];
  } catch {
    return [];
  }
}
