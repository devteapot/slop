import type { SweepConfig } from "../runner/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";

/**
 * Validation sweep for the todo app. Small scale, one scenario, SLOP vs MCP.
 * Confirms the new app binding works end-to-end.
 */
export const smokeTodoSweep: SweepConfig = {
  id: "smoke-todo",
  providers: [
    { kind: "openai-compat", baseUrl: DGX_URL, model: "gemma4:31b" },
  ],
  promptVariants: ["spec"],
  encodingVariants: ["indented-text"],
  optimizationVariants: ["off"],
  protocols: ["slop", "mcp"],
  mcpVariants: ["flat"],
  apps: ["todo"],
  dataScales: ["s"],
  scenarioFilter: ["mark-all-done"],
  seeds: [42],
  iterations: 1,
  maxConcurrency: 1,
  maxTurns: 30,
  temperature: 0,
};
