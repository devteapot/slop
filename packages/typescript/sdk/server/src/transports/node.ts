import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Connection, SlopServer } from "../server";

export interface AttachSlopOptions {
  /** WebSocket path. Defaults to "/slop". */
  path?: string;
  /** Whether to serve /.well-known/slop discovery endpoint. Defaults to true. */
  discovery?: boolean;
  /**
   * Authenticate the incoming upgrade request. Return `true` (or a promise
   * resolving to `true`) to accept. Return `false` to reject with `401`.
   * Throw to reject with `401`.
   *
   * Per spec/core/transport.md §Security considerations, WebSocket transports
   * MUST authenticate every non-loopback connection. If this option is not
   * supplied and the upgrade is not from loopback, the handler responds `401`.
   * Set `authenticate: () => true` to opt out explicitly (not recommended).
   */
  authenticate?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /**
   * Allowed `Origin` values for browser connections. Non-browser upgrades
   * (no `Origin` header) are not checked. Defaults to same-origin only.
   */
  allowedOrigins?: string[];
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
export function attachSlop(slop: SlopServer, httpServer: HttpServer, options: AttachSlopOptions = {}): void {
  const path = options.path ?? "/slop";
  const discovery = options.discovery !== false;
  const authenticate = options.authenticate;
  const allowedOrigins = options.allowedOrigins;

  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades
  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (url.pathname !== path) return;

    const reject = (status: number, reason: string) => {
      socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
      socket.destroy();
    };

    // Origin allowlist. When the client sent Origin (i.e. browser), an
    // allowlist is required per spec/core/transport.md §Security
    // considerations — default-deny if none is configured.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowedOrigins) {
        console.warn(
          "[slop] refusing browser WebSocket upgrade: no allowedOrigins configured. " +
            "See spec/core/transport.md §Security considerations.",
        );
        reject(403, "Forbidden");
        return;
      }
      if (!allowedOrigins.includes(origin)) {
        reject(403, "Forbidden");
        return;
      }
    }

    // Authentication. If no authenticate hook is supplied, default-deny any
    // non-loopback upgrade per spec/core/transport.md §Security considerations.
    const remote = req.socket.remoteAddress ?? "";
    const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (authenticate) {
      try {
        const ok = await authenticate(req);
        if (!ok) {
          reject(401, "Unauthorized");
          return;
        }
      } catch {
        reject(401, "Unauthorized");
        return;
      }
    } else if (!isLoopback) {
      console.warn(
        "[slop] refusing non-loopback WebSocket upgrade: no authenticate hook configured. " +
          "See spec/core/transport.md §Security considerations.",
      );
      reject(401, "Unauthorized");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
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
    const originalListeners = httpServer.listeners("request") as ((
      req: IncomingMessage,
      res: ServerResponse,
    ) => void)[];
    httpServer.removeAllListeners("request");

    httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/.well-known/slop") {
        const host = req.headers.host ?? "localhost";
        const protocol = "ws";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: slop.id,
            name: slop.name,
            slop_version: "0.1",
            transport: { type: "ws", url: `${protocol}://${host}${path}` },
            capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
          }),
        );
        return;
      }

      // Pass to original listeners
      for (const listener of originalListeners) {
        listener(req, res);
      }
    });
  }
}
