// Client-side exports
export { useSlopUI, useSlop } from "./hooks";
export { SlopUIAdapter } from "./adapter";

// Middleware (client+server safe — resolves slop instance at runtime from globalThis)
import { createMiddleware } from "@tanstack/react-start";

/**
 * Create a TanStack Start middleware that auto-refreshes the SLOP tree
 * after any server function completes.
 *
 * Resolves the SlopServer instance at runtime from the shared singleton map.
 * No ID needed if your app has one SlopServer (the common case).
 *
 * ```ts
 * // server/middleware.ts
 * import { createSlopMiddleware } from "@slop-ai/tanstack-start";
 * export const slopMiddleware = createSlopMiddleware();
 * ```
 */
export function createSlopMiddleware(slopId?: string) {
  return createMiddleware().server(async ({ next }: any) => {
    const result = await next();
    const instances: Map<string, any> | undefined = (globalThis as any).__slop_instances;
    if (!instances || instances.size === 0) return result;

    let slop;
    if (slopId) {
      slop = instances.get(slopId);
    } else if (instances.size === 1) {
      slop = instances.values().next().value;
    } else {
      console.warn("[slop] Multiple SlopServer instances found. Pass the ID to createSlopMiddleware().");
      return result;
    }

    if (slop) slop.refresh();
    return result;
  });
}
