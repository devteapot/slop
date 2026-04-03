import type { SlopServer } from "../server";

/**
 * Create a Vite plugin that attaches a SLOP WebSocket handler to the dev server.
 *
 * ```ts
 * // vite.config.ts
 * import { slopPlugin } from "@slop-ai/server/vite";
 * export default { plugins: [sveltekit(), slopPlugin(slop)] };
 * ```
 */
export function slopPlugin(
  slop: SlopServer,
  options: { path?: string } = {}
) {
  const path = options.path ?? "/slop";

  return {
    name: "slop-server",
    configureServer(server: any) {
      // Dynamic import to avoid bundling ws at build time
      import("../transports/node").then(({ attachSlop }) => {
        if (server.httpServer) {
          attachSlop(slop, server.httpServer, { path, discovery: true });
          console.log(`[slop] WebSocket endpoint ready at ${path}`);
        }
      });
    },
  };
}
