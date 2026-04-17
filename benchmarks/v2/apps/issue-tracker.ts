import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { IssueTrackerStore } from "../../mcp-vs-slop/app/store.ts";
import { createSeedData, createLargeSeedData } from "../../mcp-vs-slop/app/seed.ts";
import { startSlopServer, type SlopServerOpts } from "../../mcp-vs-slop/app/slop-server.ts";
import type { AppBinding, AppStore, McpServerHandle, SlopServerHandle } from "./registry.ts";
import type { DataScale } from "../runner/types.ts";
import type { Scenario, VerificationResult } from "../../mcp-vs-slop/scenarios/types.ts";

import { exploreAndAct } from "../../mcp-vs-slop/scenarios/explore-and-act.ts";
import { triage } from "../../mcp-vs-slop/scenarios/triage.ts";
import { bulkUpdate } from "../../mcp-vs-slop/scenarios/bulk-update.ts";
import { scaleTriage } from "../../mcp-vs-slop/scenarios/scale-triage.ts";
import { negative } from "../../mcp-vs-slop/scenarios/negative.ts";
import { contextual } from "../../mcp-vs-slop/scenarios/contextual.ts";
import { recovery } from "../../mcp-vs-slop/scenarios/recovery.ts";
import { stateTransitions } from "../../mcp-vs-slop/scenarios/state-transitions.ts";
import { crossEntity } from "../../mcp-vs-slop/scenarios/cross-entity.ts";
import { conditional } from "../../mcp-vs-slop/scenarios/conditional.ts";
import { ambiguity } from "../../mcp-vs-slop/scenarios/ambiguity.ts";
import { complexWorkflow } from "../../mcp-vs-slop/scenarios/complex-workflow.ts";

// v1 exposes only two seed sizes; we map them to the v2 scale axis. Phase F
// will grow the app's own generators so `m` / `xl` become supported.
function seedForScale(scale: DataScale) {
  switch (scale) {
    case "s":
      return createSeedData();
    case "l":
      return createLargeSeedData();
    default:
      throw new Error(`issue-tracker: scale "${scale}" not yet supported (supported: s, l)`);
  }
}

function wrap(inner: IssueTrackerStore): AppStore & { inner: IssueTrackerStore } {
  return { __brand: "app-store", inner } as AppStore & { inner: IssueTrackerStore };
}

export const issueTrackerApp: AppBinding = {
  id: "issue-tracker",
  supportedScales: ["s", "l"],
  createStore(scale, _seed) {
    const store = new IssueTrackerStore();
    store.reset(seedForScale(scale));
    return wrap(store);
  },
  async startSlopServer(store, port, opts: SlopServerOpts | undefined): Promise<SlopServerHandle> {
    const inner = (store as unknown as { inner: IssueTrackerStore }).inner;
    const { server: httpServer, slop } = startSlopServer(inner, port, opts);
    return {
      wsUrl: `ws://localhost:${port}/slop`,
      stop: async () => {
        slop.stop();
        httpServer.stop();
      },
    };
  },
  scenarios: [
    exploreAndAct,
    triage,
    bulkUpdate,
    scaleTriage,
    negative,
    contextual,
    recovery,
    stateTransitions,
    crossEntity,
    conditional,
    ambiguity,
    complexWorkflow,
  ],
  verify(store, scenario) {
    if (!scenario.verify) return undefined;
    const inner = (store as unknown as { inner: IssueTrackerStore }).inner;
    return scenario.verify(inner);
  },
  mcpSystemPrompt:
    "You are an issue tracker agent. You have access to tools to interact with repositories, issues, and comments. " +
    "You have NO prior knowledge of the data — use the tools to discover the current state. " +
    'When done, respond with "DONE".',
  async startMcpServer(scale: DataScale, _variant: string): Promise<McpServerHandle> {
    // All current MCP variants share the flat server; prompt-level variants
    // are applied by the cell runner via resolveMcpVariant.
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (scale === "l") env.BENCH_LARGE_DATASET = "1";
    else if (scale === "s") delete env.BENCH_LARGE_DATASET;
    else throw new Error(`issue-tracker mcp: scale "${scale}" not supported`);

    const serverPath = new URL("../../mcp-vs-slop/app/mcp-server.ts", import.meta.url).pathname;
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
        const tempStore = new IssueTrackerStore();
        const reposRes = await client.callTool({ name: "list_repos", arguments: {} });
        const repos = parseToolJson(reposRes, []);
        tempStore.repos = repos as IssueTrackerStore["repos"];
        for (const repo of repos as Array<{ id: string }>) {
          const issuesRes = await client.callTool({ name: "list_issues", arguments: { repo_id: repo.id } });
          const issues = parseToolJson(issuesRes, []);
          tempStore.issues.push(...(issues as IssueTrackerStore["issues"]));
        }
        for (const issue of tempStore.issues) {
          const commentsRes = await client.callTool({ name: "list_comments", arguments: { issue_id: issue.id } });
          const comments = parseToolJson(commentsRes, []);
          tempStore.comments.push(...(comments as IssueTrackerStore["comments"]));
        }
        return scenario.verify(tempStore);
      },
    };
  },
};

function parseToolJson(result: unknown, fallback: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
