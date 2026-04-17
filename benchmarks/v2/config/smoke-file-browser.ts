import type { SweepConfig } from "../runner/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";

/**
 * Validation sweep for the file-browser app. delete-empty-dirs exercises the
 * state-dependent affordance (delete only available on empty dirs) on SLOP,
 * which MCP has no equivalent of.
 */
export const smokeFileBrowserSweep: SweepConfig = {
  id: "smoke-file-browser",
  providers: [
    { kind: "openai-compat", baseUrl: DGX_URL, model: "gemma4:31b" },
  ],
  promptVariants: ["spec"],
  encodingVariants: ["indented-text"],
  optimizationVariants: ["off"],
  protocols: ["slop", "mcp"],
  mcpVariants: ["flat"],
  apps: ["file-browser"],
  dataScales: ["s"],
  scenarioFilter: ["delete-empty-dirs"],
  seeds: [42],
  iterations: 1,
  maxConcurrency: 1,
  maxTurns: 30,
  temperature: 0,
};
