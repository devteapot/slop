import type { SlopServer, Connection } from "../server";

/**
 * Create a Nitro WebSocket handler for Nuxt.
 *
 * ```ts
 * // server/routes/slop.ts
 * import { nitroHandler } from "@slop-ai/server/nitro";
 * export default nitroHandler(slop);
 * ```
 *
 * Requires `nitro: { experimental: { websocket: true } }` in nuxt.config.
 */
export function nitroHandler(slop: SlopServer) {
  const peerConnections = new WeakMap<any, Connection>();

  return {
    open(peer: any) {
      const conn: Connection = {
        send(message: unknown) {
          try { peer.send(JSON.stringify(message)); } catch {}
        },
        close() {
          try { peer.close(); } catch {}
        },
      };
      peerConnections.set(peer, conn);
      slop.handleConnection(conn);
    },

    message(peer: any, message: any) {
      const conn = peerConnections.get(peer);
      if (!conn) return;
      try {
        const text = typeof message === "string" ? message : message.text();
        const msg = JSON.parse(text);
        slop.handleMessage(conn, msg);
      } catch {}
    },

    close(peer: any) {
      const conn = peerConnections.get(peer);
      if (conn) {
        slop.handleDisconnect(conn);
        peerConnections.delete(peer);
      }
    },
  };
}
