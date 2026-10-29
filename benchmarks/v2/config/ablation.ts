import type { SweepConfig } from "../runner/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";

/**
 * First real ablation: prompts × encodings × protocols on the todo app's
 * fastest scenario at small scale. Goal is to light up every registry entry
 * at least once and let the dashboard pivot across dimensions.
 *
 * Cell math: 3 prompts × 3 encodings × 1 optimization = 9 SLOP cells,
 * plus 2 MCP variants = 11 cells × 1 iteration.
 */
export const ablationSweep: SweepConfig = {
  id: "ablation-prompts-encodings",
  providers: [
    { kind: "openai-compat", baseUrl: DGX_URL, model: "gemma4:31b" },
  ],
  promptVariants: ["minimal", "spec", "spec-terse"],
  encodingVariants: ["indented-text", "json-compact", "markdown-headings"],
  optimizationVariants: ["off"],
  protocols: ["slop", "mcp"],
  mcpVariants: ["flat", "flat+prompt"],
  apps: ["todo"],
  dataScales: ["s"],
  scenarioFilter: ["mark-all-done"],
  seeds: [42],
  iterations: 1,
  maxConcurrency: 1,
  maxTurns: 30,
  temperature: 0,
};
