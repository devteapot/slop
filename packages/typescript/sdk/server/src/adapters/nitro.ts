import type { Connection, SlopServer } from "../server";

export interface NitroHandlerOptions {
  /**
   * Authenticate the incoming upgrade. Return `true` (or a promise resolving
   * to `true`) to accept. Return `false` or throw to reject with `401`.
   *
   * Per spec/core/transport.md §Security considerations, WebSocket transports
   * MUST authenticate every non-loopback connection. If this option is not
   * supplied the upgrade handler rejects all connections. Set
   * `authenticate: () => true` to opt out explicitly (not recommended).
   */
  authenticate?: (req: NitroUpgradeRequest) => boolean | Promise<boolean>;
  /**
   * Allowed `Origin` values for browser connections. Non-browser upgrades
   * (no `Origin` header) are not checked.
   */
  allowedOrigins?: string[];
}

interface NitroUpgradeRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Create a Nitro WebSocket handler for Nuxt.
 *
 * ```ts
 * // server/routes/slop.ts
 * import { nitroHandler } from "@slop-ai/server/nitro";
 * export default nitroHandler(slop, { authenticate: (req) => verify(req.headers.authorization) });
 * ```
 *
 * Requires `nitro: { experimental: { websocket: true } }` in nuxt.config.
 */
export function nitroHandler(slop: SlopServer, options: NitroHandlerOptions = {}) {
  type NitroPeer = {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    request?: NitroUpgradeRequest;
  };
  type NitroMessage = string | { text(): string };

  const peerConnections = new WeakMap<NitroPeer, Connection>();
  const authenticate = options.authenticate;
  const allowedOrigins = options.allowedOrigins;

  return {
    async upgrade(req: NitroUpgradeRequest): Promise<globalThis.Response | undefined> {
      const originRaw = req.headers.origin;
      const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
      if (origin && allowedOrigins && !allowedOrigins.includes(origin)) {
        return new globalThis.Response("Forbidden", { status: 403 });
      }

      if (authenticate) {
        try {
          const ok = await authenticate(req);
          if (!ok) return new globalThis.Response("Unauthorized", { status: 401 });
        } catch {
          return new globalThis.Response("Unauthorized", { status: 401 });
        }
      } else {
        console.warn(
          "[slop] refusing Nitro WebSocket upgrade: no authenticate hook configured. " +
            "See spec/core/transport.md §Security considerations.",
        );
        return new globalThis.Response("Unauthorized", { status: 401 });
      }
      return undefined;
    },

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
