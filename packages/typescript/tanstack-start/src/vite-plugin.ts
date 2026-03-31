import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { SlopHandlerOptions } from "./ws-handler";
import { createWebSocketHandler } from "./ws-handler";

/**
 * Creates a Vite plugin that attaches a SLOP WebSocket endpoint
 * for AI consumers to the Vite dev server.
 *
 * ```ts
 * // app.config.ts or vite.config.ts
 * import { slopVitePlugin } from "@slop-ai/tanstack-start/vite-plugin";
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
    configureServer(server: any) {
      const httpServer: HttpServer = server.httpServer;
      if (!httpServer) return;

      const handler = createWebSocketHandler(options);
      const wss = new WebSocketServer({ noServer: true });

      httpServer.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === path) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        }
      });

      // Bridge ws WebSocket connections to the peer-based handler
      wss.on("connection", (ws: WebSocket, req: any) => {
        // Create a peer-like object that the handler expects
        const peer = {
          send(data: string) {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
          },
          close() { ws.close(); },
          __slopRequest: req,
          __slop: null as any,
        };

        handler.open(peer);

        ws.on("message", (data) => {
          // Wrap raw data in a peer message-like object
          const msg = {
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
      const originalListeners = httpServer.listeners("request") as Function[];
      httpServer.removeAllListeners("request");
      httpServer.on("request", (req: any, res: any) => {
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
