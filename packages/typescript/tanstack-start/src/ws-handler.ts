import type { SlopServer, Connection } from "@slop-ai/server";

/**
 * Options for creating the WebSocket handler.
 */
export interface SlopHandlerOptions {
  /**
   * Resolve the SlopServer instance for a connection.
   * For single-user apps, return a singleton.
   * For multi-user apps, use the context (e.g., auth cookie from the upgrade request)
   * to look up or create a per-session instance.
   *
   * @param context - The peer context (contains request headers, cookies, etc.)
   */
  resolve: (context: any) => SlopServer | Promise<SlopServer>;
}

/**
 * Creates an h3/CrossWS WebSocket handler for AI consumers.
 * Speaks standard SLOP protocol (subscribe, invoke, query, etc.).
 *
 * The server is the data provider. The browser runs a separate UI provider
 * via `@slop-ai/client` (postMessage). AI consumers subscribe to the server
 * for data state — the consumer (extension/desktop) merges both trees.
 *
 * ```ts
 * // Single-user (demo/dev)
 * createWebSocketHandler({ resolve: () => slop });
 *
 * // Multi-user (production)
 * createWebSocketHandler({
 *   resolve: (ctx) => {
 *     const session = getSessionFromCookie(ctx.request);
 *     return getOrCreateSlop(session);
 *   },
 * });
 * ```
 */
export function createWebSocketHandler(options: SlopHandlerOptions) {
  const clients = new Map<any, { conn: Connection; slop: SlopServer }>();

  return {
    async open(peer: any) {
      const slop = await options.resolve(peer);
      const conn = peerToConnection(peer);
      clients.set(peer, { conn, slop });
      slop.handleConnection(conn);
    },

    async message(peer: any, rawMsg: any) {
      const text = typeof rawMsg === "string" ? rawMsg : rawMsg.text();
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      const client = clients.get(peer);
      if (!client) return;

      // Standard SLOP protocol — subscribe, unsubscribe, query, invoke
      client.slop.handleMessage(client.conn, msg);
    },

    close(peer: any) {
      const client = clients.get(peer);
      if (client) {
        client.slop.handleDisconnect(client.conn);
        clients.delete(peer);
      }
    },
  };
}

// --- Helper ---

const peerConnections = new WeakMap<any, Connection>();

function peerToConnection(peer: any): Connection {
  let conn = peerConnections.get(peer);
  if (!conn) {
    conn = {
      send(message: unknown) {
        try { peer.send(JSON.stringify(message)); } catch {}
      },
      close() {
        try { peer.close(); } catch {}
      },
    };
    peerConnections.set(peer, conn);
  }
  return conn;
}
