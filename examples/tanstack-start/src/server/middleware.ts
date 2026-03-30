import { createMiddleware } from "@tanstack/react-start";

/**
 * TanStack Start middleware that auto-refreshes the SLOP tree after
 * any server function completes. Uses dynamic import so no server-only
 * code leaks into the client bundle.
 */
export const slopMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const { slop } = await import("./slop");
  slop.refresh();
  return result;
});
