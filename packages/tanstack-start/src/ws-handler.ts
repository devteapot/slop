import type { SlopServer, Connection } from "@slop-ai/server";

interface BrowserClient {
  peer: any;
  conn: Connection;
  slop: SlopServer;
  dataVersion: number;
  registeredPaths: Set<string>;
  unsubChange: (() => void) | null;
}

interface AIClient {
  peer: any;
  conn: Connection;
  slop: SlopServer;
}

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
 * Creates an h3/CrossWS WebSocket handler that bridges:
 * - AI consumers (standard SLOP protocol: subscribe, invoke, etc.)
 * - Browser clients (bidirectional: register/unregister UI state, invoke_ui, data_changed)
 *
 * Supports per-session trees via the `resolve` function.
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
  const browserClients = new Map<any, BrowserClient>();
  const aiClients = new Map<any, AIClient>();

  return {
    async open(peer: any) {
      // Resolve the SlopServer for this connection
      const slop = await options.resolve(peer);
      (peer as any).__slop = slop;

      // Send hello immediately — the extension expects it on connect
      const conn = peerToConnection(peer);
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

      const slop: SlopServer = (peer as any).__slop;
      if (!slop) return;

      // --- Browser client: hydrate message ---
      if (msg.type === "hydrate") {
        const conn = peerToConnection(peer);
        const client: BrowserClient = {
          peer,
          conn,
          slop,
          dataVersion: msg.dataVersion ?? 0,
          registeredPaths: new Set(),
          unsubChange: null,
        };

        // Listen for server state changes to notify this browser client
        client.unsubChange = slop.onChange(() => {
          try {
            peer.send(JSON.stringify({ type: "data_changed" }));
          } catch {}
        });

        browserClients.set(peer, client);

        // Version check — if data is stale, tell browser to re-fetch
        if (msg.dataVersion < slop.getVersion()) {
          peer.send(JSON.stringify({ type: "data_changed" }));
        }
        return;
      }

      // --- Browser client: UI state registration ---
      const browserClient = browserClients.get(peer);

      if (msg.type === "register" && browserClient) {
        const uiPath = `ui/${msg.path}`;
        browserClient.registeredPaths.add(uiPath);
        slop.register(uiPath, msg.descriptor);
        return;
      }

      if (msg.type === "unregister" && browserClient) {
        const uiPath = `ui/${msg.path}`;
        browserClient.registeredPaths.delete(uiPath);
        slop.unregister(uiPath);
        return;
      }

      // --- Standard SLOP messages (from browser or AI consumer) ---
      let conn: Connection;

      if (browserClient) {
        conn = browserClient.conn;
      } else {
        // AI consumer — track if not already tracked
        let aiClient = aiClients.get(peer);
        if (!aiClient) {
          conn = peerToConnection(peer);
          aiClient = { peer, conn, slop };
          aiClients.set(peer, aiClient);
        }
        conn = aiClient.conn;
      }

      // Check if this is an invoke for a ui/ path — forward to browser
      if (msg.type === "invoke") {
        const path = msg.path ?? "";
        const isUIAction = path.startsWith("/ui/") || path.startsWith("ui/") ||
                           path.includes("/ui/");

        if (isUIAction) {
          // Forward to the browser client for this session
          for (const [, client] of browserClients) {
            if (client.slop === slop) {
              try {
                client.peer.send(JSON.stringify({
                  type: "invoke_ui",
                  id: msg.id,
                  path,
                  action: msg.action,
                  params: msg.params,
                }));
              } catch {}
            }
          }

          // Send immediate result
          conn.send({ type: "result", id: msg.id, status: "ok" });
          return;
        }
      }

      // Delegate to SLOP server for standard protocol handling
      slop.handleMessage(conn, msg);
    },

    close(peer: any) {
      const browserClient = browserClients.get(peer);
      if (browserClient) {
        // Unsubscribe from change notifications
        browserClient.unsubChange?.();
        // Clean up all ui/ registrations
        for (const path of browserClient.registeredPaths) {
          browserClient.slop.unregister(path);
        }
        browserClients.delete(peer);
        browserClient.slop.handleDisconnect(browserClient.conn);
        return;
      }

      const aiClient = aiClients.get(peer);
      if (aiClient) {
        aiClients.delete(peer);
        aiClient.slop.handleDisconnect(aiClient.conn);
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
