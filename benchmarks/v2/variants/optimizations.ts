import type { SlopServerOpts } from "../../mcp-vs-slop/app/slop-server.ts";

/**
 * An "optimization" is how the SLOP server chooses to shape the tree it emits
 * before the encoder sees it. Today v1 collapses this into a single
 * `optimized: boolean` server option; v2 keeps the dimension open for when
 * server-side salience / lazy / windowing become independently toggleable.
 */

export type OptimizationVariant = {
  id: string;
  description: string;
  serverOpts?: SlopServerOpts;
};

export const OPTIMIZATION_VARIANTS: Record<string, OptimizationVariant> = {
  off: {
    id: "off",
    description: "No server-side optimization — full tree, every node, every child.",
    serverOpts: undefined,
  },
  combined: {
    id: "combined",
    description: "v1 'optimized' mode — salience scoring + lazy comments + summaries.",
    serverOpts: { optimized: true },
  },
};

export function resolveOptimization(id: string): OptimizationVariant {
  const v = OPTIMIZATION_VARIANTS[id];
  if (!v) throw new Error(`Unknown optimization variant: ${id}. Available: ${Object.keys(OPTIMIZATION_VARIANTS).join(", ")}`);
  return v;
}
