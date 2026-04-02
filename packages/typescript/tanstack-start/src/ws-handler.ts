import type { SlopServer, Connection } from "@slop-ai/server";
import { UiMountSession } from "./ui-mount";

type RequestLike = {
  url?: string;
  headers?: {
    host?: string;
  };
};

type PeerContext = {
  request?: RequestLike;
  __slopRequest?: RequestLike;
};

type HandlerPeer = PeerContext & {
  send(data: string): void;
  close(): void;
};

type RawPeerMessage = string | { text(): string };

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
  resolve: (context: PeerContext) => SlopServer | Promise<SlopServer>;
  /**
   * Path to mount the browser-owned UI subtree under.
   * Defaults to `ui`.
   */
  uiMountPath?: string;
}

/**
 * Creates an h3/CrossWS WebSocket handler for AI consumers.
 * Speaks standard SLOP protocol (subscribe, invoke, query, etc.).
 *
 * The public `/slop` endpoint remains the app's server provider for AI
 * consumers. Browser UI state connects back into the same handler with
 * `?slop_role=provider`, and the server mounts that per-tab UI tree under
 * `ui` so consumers still subscribe to a single provider.
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
  const clients = new Map<HandlerPeer, { conn: Connection; slop: SlopServer }>();
  const providerClients = new Map<HandlerPeer, {
    session: UiMountSession;
    slop: SlopServer;
    mountPath: string;
  }>();
  const activeMounts = new WeakMap<SlopServer, Map<string, UiMountSession>>();

  return {
    async open(peer: HandlerPeer) {
      const context = getPeerContext(peer);
      const slop = await options.resolve(context);
      const url = getPeerUrl(peer);
      const isProvider = url?.searchParams.get("slop_role") === "provider";

      if (isProvider) {
        const mountPath =
          url?.searchParams.get("mount") || options.uiMountPath || "ui";
        const session = new UiMountSession(slop, peerToConnection(peer), mountPath);
        const mounts = ensureMountMap(activeMounts, slop);
        const existing = mounts.get(mountPath);
        if (existing && existing !== session) {
          existing.deactivate("Browser UI session replaced by a newer tab");
        }
        mounts.set(mountPath, session);
        providerClients.set(peer, { session, slop, mountPath });
        session.start();
        return;
      }

      const conn = peerToConnection(peer);
      clients.set(peer, { conn, slop });
      slop.handleConnection(conn);
    },

    async message(peer: HandlerPeer, rawMsg: RawPeerMessage) {
      const text = typeof rawMsg === "string" ? rawMsg : rawMsg.text();
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch (e) {
        console.warn("[slop] failed to parse WebSocket handler message:", e);
        return;
      }

      const providerClient = providerClients.get(peer);
      if (providerClient) {
        if (isProviderMessage(msg)) {
          providerClient.session.handleMessage(msg);
        } else {
          console.warn("[slop] ignoring invalid browser UI provider message");
        }
        return;
      }

      const client = clients.get(peer);
      if (!client) return;

      // Standard SLOP protocol — subscribe, unsubscribe, query, invoke
      client.slop.handleMessage(client.conn, msg);
    },

    close(peer: HandlerPeer) {
      const providerClient = providerClients.get(peer);
      if (providerClient) {
        const mounts = activeMounts.get(providerClient.slop);
        if (mounts?.get(providerClient.mountPath) === providerClient.session) {
          mounts.delete(providerClient.mountPath);
        }
        providerClient.session.deactivate("Browser UI session disconnected");
        providerClients.delete(peer);
        return;
      }

      const client = clients.get(peer);
      if (client) {
        client.slop.handleDisconnect(client.conn);
        clients.delete(peer);
      }
    },
  };
}

// --- Helper ---

const peerConnections = new WeakMap<HandlerPeer, Connection>();

function peerToConnection(peer: HandlerPeer): Connection {
  let conn = peerConnections.get(peer);
  if (!conn) {
    conn = {
      send(message: unknown) {
        try {
          peer.send(JSON.stringify(message));
        } catch (e) {
          console.warn("[slop] failed to send WebSocket handler message:", e);
        }
      },
      close() {
        try {
          peer.close();
        } catch (e) {
          console.warn("[slop] failed to close WebSocket handler peer:", e);
        }
      },
    };
    peerConnections.set(peer, conn);
  }
  return conn;
}

function getPeerContext(peer: HandlerPeer): PeerContext {
  if (peer?.request) {
    return peer;
  }

  if (peer?.__slopRequest) {
    return {
      ...peer,
      request: peer.__slopRequest,
    };
  }

  return peer;
}

function getPeerUrl(peer: HandlerPeer): URL | null {
  const request: RequestLike | undefined = peer.request ?? peer.__slopRequest;
  if (!request?.url) return null;

  try {
    return new URL(
      request.url,
      `http://${request.headers?.host ?? "localhost"}`,
    );
  } catch (e) {
    console.warn("[slop] failed to parse peer URL:", e);
    return null;
  }
}

function ensureMountMap(
  cache: WeakMap<SlopServer, Map<string, UiMountSession>>,
  slop: SlopServer,
): Map<string, UiMountSession> {
  let mounts = cache.get(slop);
  if (!mounts) {
    mounts = new Map<string, UiMountSession>();
    cache.set(slop, mounts);
  }
  return mounts;
}

function isProviderMessage(value: unknown): value is Parameters<UiMountSession["handleMessage"]>[0] {
  return !!value
    && typeof value === "object"
    && typeof (value as { type?: unknown }).type === "string";
}
