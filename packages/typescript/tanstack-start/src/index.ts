// Client-side exports
export { useSlopUI, useSlop } from "./hooks";

// Middleware (client+server safe — resolves slop instance at runtime from globalThis)
import { createMiddleware } from "@tanstack/react-start";
import type { SlopServer } from "@slop-ai/server";

declare global {
  var __slop_instances: Map<string, SlopServer<unknown>> | undefined;
}

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
  return createMiddleware().server(async ({ next }) => {
    const result = await next();
    const instances = globalThis.__slop_instances;
    if (!instances || instances.size === 0) return result;

    let slop: SlopServer<unknown> | undefined;
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
