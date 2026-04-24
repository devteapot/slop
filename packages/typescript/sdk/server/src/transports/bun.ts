import type { Connection, SlopServer } from "../server";

/**
 * Create a Bun.serve handler for SLOP.
 *
 * ```ts
 * import { bunHandler } from "@slop-ai/server/bun";
 *
 * const handler = bunHandler(slop, { path: "/slop" });
 *
 * Bun.serve({
 *   fetch(req, server) {
 *     const resp = handler.fetch(req, server);
 *     if (resp) return resp;
 *     return new Response("Hello");
 *   },
 *   websocket: handler.websocket,
 * });
 * ```
 */
export interface BunHandlerOptions {
  path?: string;
  discovery?: boolean;
  /**
   * Authenticate the incoming upgrade request. Return `true` to accept,
   * `false` to reject with `401`. See spec/core/transport.md §Security.
   *
   * If not supplied, non-loopback upgrades are rejected with `401` by default.
   */
  authenticate?: (req: Request) => boolean | Promise<boolean>;
  /** Allowed `Origin` values for browser upgrades. */
  allowedOrigins?: string[];
}

export function bunHandler(slop: SlopServer, options: BunHandlerOptions = {}) {
  const path = options.path ?? "/slop";
  const discovery = options.discovery !== false;
  const authenticate = options.authenticate;
  const allowedOrigins = options.allowedOrigins;

  const connections = new WeakMap<any, Connection>();

  return {
    async fetch(req: Request, server: any): Promise<Response | undefined> {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === path && req.headers.get("upgrade") === "websocket") {
        const origin = req.headers.get("origin");
        if (origin !== null && allowedOrigins && !allowedOrigins.includes(origin)) {
          return new Response("Forbidden", { status: 403 });
        }

        const remote = (server.requestIP?.(req) as { address?: string } | null)?.address ?? "";
        const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";

        if (authenticate) {
          try {
            const ok = await authenticate(req);
            if (!ok) return new Response("Unauthorized", { status: 401 });
          } catch {
            return new Response("Unauthorized", { status: 401 });
          }
        } else if (!isLoopback) {
          console.warn(
            "[slop] refusing non-loopback WebSocket upgrade: no authenticate hook configured. " +
              "See spec/core/transport.md §Security considerations.",
          );
          return new Response("Unauthorized", { status: 401 });
        }

        const upgraded = server.upgrade(req);
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // Discovery
      if (discovery && url.pathname === "/.well-known/slop") {
        const host = req.headers.get("host") ?? "localhost";
        return Response.json({
          id: slop.id,
          name: slop.name,
          slop_version: "0.1",
          transport: { type: "ws", url: `ws://${host}${path}` },
          capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
        });
      }

      return undefined;
    },

    websocket: {
      open(ws: any) {
        const conn: Connection = {
          send(message: unknown) {
            ws.send(JSON.stringify(message));
          },
          close() {
            ws.close();
          },
        };
        connections.set(ws, conn);
        slop.handleConnection(conn);
      },

      message(ws: any, message: string | Buffer) {
        const conn = connections.get(ws);
        if (!conn) return;
        try {
          const msg = JSON.parse(typeof message === "string" ? message : message.toString());
          slop.handleMessage(conn, msg);
        } catch (e) {
          console.warn("[slop] failed to parse WebSocket message:", e);
        }
      },

      close(ws: any) {
        const conn = connections.get(ws);
        if (conn) {
          slop.handleDisconnect(conn);
          connections.delete(ws);
        }
      },
    },
  };
}
