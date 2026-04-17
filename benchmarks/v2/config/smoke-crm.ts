import type { SweepConfig } from "../runner/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";

/**
 * Validation sweep for the crm app. Runs one easy scenario (high-value-alert)
 * on both SLOP and MCP at scale=s so we can see the top-of-ladder end-to-end
 * without blowing out token budgets.
 */
export const smokeCrmSweep: SweepConfig = {
  id: "smoke-crm",
  providers: [
    { kind: "openai-compat", baseUrl: DGX_URL, model: "gemma4:31b" },
  ],
  promptVariants: ["spec"],
  encodingVariants: ["indented-text"],
  optimizationVariants: ["off"],
  protocols: ["slop", "mcp"],
  mcpVariants: ["flat"],
  apps: ["crm"],
  dataScales: ["s"],
  scenarioFilter: ["high-value-alert"],
  seeds: [42],
  iterations: 1,
  maxConcurrency: 1,
  maxTurns: 40,
  temperature: 0,
};
