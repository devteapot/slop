import type { Client } from "@modelcontextprotocol/sdk/client";
import type { SlopServerOpts } from "../../mcp-vs-slop/app/slop-server.ts";
import type { Scenario, VerificationResult } from "../../mcp-vs-slop/scenarios/types.ts";
import type { AppId, DataScale } from "../runner/types.ts";
import { crmApp } from "./crm/index.ts";
import { fileBrowserApp } from "./file-browser/index.ts";
import { issueTrackerApp } from "./issue-tracker.ts";
import { todoApp } from "./todo/index.ts";

/**
 * Store + server + scenarios for a given benchmark app. Each app is a tuple
 * of (storeFactory, serverLauncher, scenarios) with a declared set of
 * supported data scales. The sweep runner skips cells whose (app, scale)
 * combination isn't supported.
 */
export interface AppBinding {
  id: AppId;
  supportedScales: DataScale[];
  /** Build a fresh store seeded for the requested scale. */
  createStore(scale: DataScale, seed: number): AppStore;
  /** Boot a SLOP server exposing the given store. Returns stop() + URL. */
  startSlopServer(store: AppStore, port: number, opts: SlopServerOpts | undefined): Promise<SlopServerHandle>;
  /** Scenarios available for this app. */
  scenarios: Scenario[];
  /** Run the scenario's verifier against this app's store. Returns undefined if the scenario has no verifier. */
  verify(store: AppStore, scenario: Scenario): VerificationResult | undefined;
  /**
   * Launch an MCP server for this app at the requested scale and return a
   * handle. `variant` selects among fair-MCP variants (flat / flat+prompt /
   * resources / prompts) — apps that only support `flat` may throw for the others.
   */
  startMcpServer?(scale: DataScale, variant: string): Promise<McpServerHandle>;
  /** System prompt for MCP runs. Domain-specific and tuned per app. */
  mcpSystemPrompt?: string;
}

export interface McpServerHandle {
  client: Client;
  stop(): Promise<void>;
  /** Rebuild enough state from MCP tool calls to run the scenario's verifier. */
  verify(scenario: Scenario): Promise<VerificationResult | undefined>;
}

export interface AppStore {
  /** Unknown-by-design — each app is responsible for its own store type. */
  readonly __brand: "app-store";
  readonly inner: unknown;
}

export interface SlopServerHandle {
  wsUrl: string;
  stop(): Promise<void>;
}

const registry: Record<AppId, AppBinding | undefined> = {
  "issue-tracker": issueTrackerApp,
  todo: todoApp,
  "file-browser": fileBrowserApp,
  crm: crmApp,
};

export function resolveApp(id: AppId): AppBinding {
  const binding = registry[id];
  if (!binding) throw new Error(`App not yet implemented in v2: ${id}`);
  return binding;
}
