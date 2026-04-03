import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import type { SlopHandlerOptions } from "./ws-handler";
import { createWebSocketHandler } from "./ws-handler";

interface ViteDevServerLike {
  httpServer?: HttpServer;
}

interface VitePeer {
  send(data: string): void;
  close(): void;
  __slopRequest: IncomingMessage;
}

interface VitePeerMessage {
  text(): string;
  toString(): string;
}

/**
 * Creates a Vite plugin that attaches a SLOP WebSocket endpoint
 * for AI consumers to the Vite dev server.
 *
 * ```ts
 * // app.config.ts or vite.config.ts
 * import { slopVitePlugin } from "@slop-ai/tanstack-start/server";
 *
 * export default defineConfig({
 *   vite: {
 *     plugins: () => [slopVitePlugin({ resolve: () => slop })],
 *   },
 * });
 * ```
 */
export function slopVitePlugin(
  options: SlopHandlerOptions & { path?: string }
) {
  const path = options.path ?? "/slop";

  return {
    name: "slop-adapter",
    configureServer(server: ViteDevServerLike) {
      const httpServer = server.httpServer;
      if (!httpServer) return;

      const handler = createWebSocketHandler(options);
      const wss = new WebSocketServer({ noServer: true });

      httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === path) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        }
      });

      // Bridge ws WebSocket connections to the peer-based handler
      wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        // Create a peer-like object that the handler expects
        const peer: VitePeer = {
          send(data: string) {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
          },
          close() { ws.close(); },
          __slopRequest: req,
        };

        handler.open(peer);

        ws.on("message", (data) => {
          // Wrap raw data in a peer message-like object
          const msg: VitePeerMessage = {
            text() { return data.toString(); },
            toString() { return data.toString(); },
          };
          handler.message(peer, msg);
        });

        ws.on("close", () => {
          handler.close(peer);
        });
      });

      // Also serve /.well-known/slop discovery
      const originalListeners = httpServer.listeners("request");
      httpServer.removeAllListeners("request");
      httpServer.on("request", (req, res) => {
        if (req.url === "/.well-known/slop") {
          const host = req.headers.host ?? "localhost";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "slop",
            name: "SLOP",
            slop_version: "0.1",
            transport: { type: "ws", url: `ws://${host}${path}` },
            capabilities: ["state", "patches", "affordances"],
          }));
          return;
        }
        for (const listener of originalListeners) {
          listener(req, res);
        }
      });

      console.log(`[slop] WebSocket adapter ready at ${path}`);
    },
  };
}
