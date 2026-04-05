import type { SlopServer, Connection } from "../server";

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
export function bunHandler(
  slop: SlopServer,
  options: { path?: string; discovery?: boolean } = {}
) {
  const path = options.path ?? "/slop";
  const discovery = options.discovery !== false;

  const connections = new WeakMap<any, Connection>();

  return {
    fetch(req: Request, server: any): Response | undefined {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === path && req.headers.get("upgrade") === "websocket") {
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
