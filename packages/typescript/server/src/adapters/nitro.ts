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
  type NitroPeer = {
    send(data: string): void;
    close(): void;
  };
  type NitroMessage = string | { text(): string };

  const peerConnections = new WeakMap<NitroPeer, Connection>();

  return {
    open(peer: NitroPeer) {
      const conn: Connection = {
        send(message: unknown) {
          try {
            peer.send(JSON.stringify(message));
          } catch (e) {
            console.warn("[slop] failed to send Nitro WebSocket message:", e);
          }
        },
        close() {
          try {
            peer.close();
          } catch (e) {
            console.warn("[slop] failed to close Nitro WebSocket peer:", e);
          }
        },
      };
      peerConnections.set(peer, conn);
      slop.handleConnection(conn);
    },

    message(peer: NitroPeer, message: NitroMessage) {
      const conn = peerConnections.get(peer);
      if (!conn) return;
      try {
        const text = typeof message === "string" ? message : message.text();
        const msg = JSON.parse(text);
        slop.handleMessage(conn, msg);
      } catch (e) {
        console.warn("[slop] failed to parse Nitro WebSocket message:", e);
      }
    },

    close(peer: NitroPeer) {
      const conn = peerConnections.get(peer);
      if (conn) {
        slop.handleDisconnect(conn);
        peerConnections.delete(peer);
      }
    },
  };
}
