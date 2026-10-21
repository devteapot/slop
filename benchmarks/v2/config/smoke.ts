import type { SweepConfig } from "../runner/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";

/**
 * Smoke sweep — smallest useful cross-section. Runs on one model, one prompt,
 * one encoding, two optimization levels, two scenarios, small data, 1 iter.
 * Target wall time: a couple of minutes on DGX gemma4:31b.
 */
export const smokeSweep: SweepConfig = {
  id: "smoke",
  providers: [
    {
      kind: "openai-compat",
      baseUrl: DGX_URL,
      model: "gemma4:31b",
    },
  ],
  promptVariants: ["spec"],
  encodingVariants: ["indented-text"],
  optimizationVariants: ["off", "combined"],
  protocols: ["slop"],
  apps: ["issue-tracker"],
  dataScales: ["s"],
  scenarioFilter: ["explore-and-act"],
  seeds: [42],
  iterations: 3,
  maxConcurrency: 1,
  maxTurns: 20,
  temperature: 0,
};
