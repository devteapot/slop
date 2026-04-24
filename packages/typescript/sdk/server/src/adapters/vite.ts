import type { IncomingMessage } from "node:http";
import type { SlopServer } from "../server";

export interface SlopPluginOptions {
  /** WebSocket path. Defaults to "/slop". */
  path?: string;
  /**
   * Authenticate the incoming upgrade request. Forwarded to `attachSlop`.
   * If unset, only loopback upgrades are accepted (appropriate for dev
   * servers bound to 127.0.0.1).
   */
  authenticate?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /**
   * Allowed `Origin` values for browser upgrades. Forwarded to `attachSlop`.
   * Required for ANY browser client — including a local browser hitting
   * `http://localhost:5173` — because the upgrade request carries an
   * `Origin` header and `attachSlop` default-denies browser upgrades when
   * no allowlist is configured. Pass the origin(s) your Vite dev server
   * serves (for example `["http://localhost:5173"]`).
   */
  allowedOrigins?: string[];
}

/**
 * Create a Vite plugin that attaches a SLOP WebSocket handler to the dev server.
 *
 * ```ts
 * // vite.config.ts
 * import { slopPlugin } from "@slop-ai/server/vite";
 * export default {
 *   plugins: [
 *     sveltekit(),
 *     slopPlugin(slop, {
 *       // required when binding off-loopback; see spec/core/transport.md
 *       // §Security considerations.
 *       allowedOrigins: ["http://localhost:5173"],
 *       authenticate: async (req) => verifyBearer(req.headers.authorization),
 *     }),
 *   ],
 * };
 * ```
 */
export function slopPlugin(slop: SlopServer, options: SlopPluginOptions = {}) {
  const path = options.path ?? "/slop";
  const { authenticate, allowedOrigins } = options;

  return {
    name: "slop-server",
    configureServer(server: any) {
      // Dynamic import to avoid bundling ws at build time
      import("../transports/node").then(({ attachSlop }) => {
        if (server.httpServer) {
          attachSlop(slop, server.httpServer, {
            path,
            discovery: true,
            authenticate,
            allowedOrigins,
          });
          console.log(`[slop] WebSocket endpoint ready at ${path}`);
        }
      });
    },
  };
}
