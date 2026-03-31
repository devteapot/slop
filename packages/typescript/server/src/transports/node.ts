import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import type { SlopServer, Connection } from "../server";

export interface AttachSlopOptions {
  /** WebSocket path. Defaults to "/slop". */
  path?: string;
  /** Whether to serve /.well-known/slop discovery endpoint. Defaults to true. */
  discovery?: boolean;
}

/**
 * Attach a SLOP WebSocket endpoint to an existing Node.js HTTP server.
 *
 * ```ts
 * import { createServer } from "node:http";
 * import { attachSlop } from "@slop-ai/server/node";
 *
 * const server = createServer(app);
 * attachSlop(slop, server, { path: "/slop" });
 * server.listen(3000);
 * ```
 */
export function attachSlop(
  slop: SlopServer,
  httpServer: HttpServer,
  options: AttachSlopOptions = {}
): void {
  const path = options.path ?? "/slop";
  const discovery = options.discovery !== false;

  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (url.pathname === path) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket) => {
    const conn: Connection = {
      send(message: unknown) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
      close() {
        ws.close();
      },
    };

    slop.handleConnection(conn);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        slop.handleMessage(conn, msg);
      } catch (e) {
        console.error("[slop] Failed to parse message:", e);
      }
    });

    ws.on("close", () => {
      slop.handleDisconnect(conn);
    });
  });

  // Intercept /.well-known/slop requests
  if (discovery) {
    const originalListeners = httpServer.listeners("request") as ((req: IncomingMessage, res: ServerResponse) => void)[];
    httpServer.removeAllListeners("request");

    httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/.well-known/slop") {
        const host = req.headers.host ?? "localhost";
        const protocol = "ws";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: slop.id,
          name: slop.name,
          slop_version: "0.1",
          transport: { type: "ws", url: `${protocol}://${host}${path}` },
          capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
        }));
        return;
      }

      // Pass to original listeners
      for (const listener of originalListeners) {
        listener(req, res);
      }
    });
  }
}
