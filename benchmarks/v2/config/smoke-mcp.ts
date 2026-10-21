import type { SweepConfig } from "../runner/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";

/**
 * SLOP-vs-MCP head-to-head smoke. One fast scenario, one model, one iter per
 * cell × 2 protocols = 2 cells. Validates that the MCP cell runner works
 * end-to-end and that verification via reconstruction passes.
 */
export const smokeMcpSweep: SweepConfig = {
  id: "smoke-mcp",
  providers: [
    {
      kind: "openai-compat",
      baseUrl: DGX_URL,
      model: "gemma4:31b",
    },
  ],
  promptVariants: ["spec"],
  encodingVariants: ["indented-text"],
  optimizationVariants: ["off"],
  protocols: ["slop", "mcp"],
  mcpVariants: ["flat"],
  apps: ["issue-tracker"],
  dataScales: ["s"],
  scenarioFilter: ["explore-and-act"],
  seeds: [42],
  iterations: 1,
  maxConcurrency: 1,
  maxTurns: 20,
  temperature: 0,
};
