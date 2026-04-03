import type { SlopConsumer, SlopNode } from "@slop-ai/consumer";
import type { Client } from "@modelcontextprotocol/sdk/client";
import type { IssueTrackerStore } from "../app/store";

export interface ScenarioStep {
  name: string;
  /** Execute this step using the SLOP consumer. The snapshot is the initial tree. */
  slop: (consumer: SlopConsumer, subId: string, snapshot: SlopNode) => Promise<void>;
  /** Execute this step using the MCP client. */
  mcp: (client: Client) => Promise<void>;
}

export interface VerificationResult {
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

export interface Scenario {
  name: string;
  description: string;
  agentPrompt: string;
  steps: ScenarioStep[];
  /** Use the large seed dataset for this scenario. Default: false (small dataset). */
  largeDataset?: boolean;
  /** Verify the store state after the agent runs. Returns pass/fail with details. */
  verify?: (store: IssueTrackerStore) => VerificationResult;
}
