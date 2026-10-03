import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { type BridgeMcpSession, createMcpSession } from "./mcp-session";
import type { Up } from "./protocol";
import { createRelayHub } from "./relay-hub";
import { readBearerToken, type TokenRegistry } from "./tokens";
import type { BridgeLogger, RelaySocketLike } from "./types";

export interface BridgeServerOptions {
  port: number;
  hostname?: string;
  tokens: TokenRegistry;
  logger?: BridgeLogger;
  relayHub?: ReturnType<typeof createRelayHub>;
  idleTimeoutMs?: number;
}

export interface BridgeServerHandle {
  port: number;
  url: string;
  relayHub: ReturnType<typeof createRelayHub>;
  stop(): void;
}

type BunServer = {
  port: number;
  url: URL;
  stop(force?: boolean): void;
  upgrade(request: Request, options?: { data?: RelaySocketData }): boolean;
};

type RelaySocketData = { userId: string };

type BunServerWebSocket = RelaySocketLike & {
  data: RelaySocketData;
};

declare const Bun: {
  serve(options: {
    port: number;
    hostname?: string;
    fetch(request: Request, server: BunServer): Response | undefined | Promise<Response | undefined>;
    websocket: {
      open(socket: BunServerWebSocket): void;
      message(socket: BunServerWebSocket, message: string | Buffer): void;
      close(socket: BunServerWebSocket): void;
    };
  }): BunServer;
};

const MCP_PATH = "/mcp";
const RELAY_PATH = "/relay";

export function createBridgeServer(options: BridgeServerOptions): BridgeServerHandle {
  const logger = options.logger ?? { info: console.error, error: console.error };
  const relayHub = options.relayHub ?? createRelayHub({ logger });
  const sessions = new Map<string, BridgeMcpSession>();

  function bearerUnauthorized(): Response {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  function json(value: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(value), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  }

  async function handleMcp(request: Request): Promise<Response> {
    const token = readBearerToken(request);
    const user = token ? options.tokens.resolveMcpToken(token) : null;
    if (!user) return bearerUnauthorized();

    const sessionId = request.headers.get("mcp-session-id");
    if (request.method === "POST") {
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (sessionId && (!session || session.userId !== user.userId)) {
        return jsonRpcError(400, "Bad Request: No valid session ID provided");
      }

      if (!session) {
        const body = await request
          .clone()
          .json()
          .catch(() => null);
        if (!isInitializeRequest(body)) {
          return jsonRpcError(400, "Bad Request: No valid session ID provided");
        }

        let createdSession: BridgeMcpSession | null = null;
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (createdSession) {
              createdSession.id = id;
              sessions.set(id, createdSession);
            }
          },
          onsessionclosed: async (id) => {
            await closeSession(id);
          },
        });
        createdSession = createMcpSession({
          id: "pending",
          userId: user.userId,
          transport,
          relayHub,
          idleTimeoutMs: options.idleTimeoutMs,
          onIdle: (id) => {
            void closeSession(id);
          },
        });
        await createdSession.server.connect(transport);
        const response = await transport.handleRequest(request);
        const initializedId = transport.sessionId;
        if (initializedId && createdSession) {
          createdSession.id = initializedId;
          sessions.set(initializedId, createdSession);
        }
        return response;
      }

      session.touch();
      return session.transport.handleRequest(request);
    }

    if (request.method === "GET" || request.method === "DELETE") {
      if (!sessionId) return new Response("Invalid or missing session ID", { status: 400 });
      const session = sessions.get(sessionId);
      if (!session || session.userId !== user.userId) {
        return new Response("Invalid or missing session ID", { status: 400 });
      }
      session.touch();
      const response = await session.transport.handleRequest(request);
      if (request.method === "DELETE") {
        await closeSession(sessionId);
      }
      return response;
    }

    return new Response("Method Not Allowed", { status: 405 });
  }

  async function closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    await session.close();
  }

  function jsonRpcError(status: number, message: string): Response {
    return json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message },
        id: null,
      },
      { status },
    );
  }

  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "0.0.0.0",
    async fetch(request, bunServer) {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") {
        return json({ ok: true });
      }
      if (url.pathname === "/debug/providers") {
        const token = readBearerToken(request);
        const user = token ? options.tokens.resolveMcpToken(token) : null;
        if (!user) return bearerUnauthorized();
        const state = relayHub.getState(user.userId);
        return json({
          userId: user.userId,
          online: state?.online ?? false,
          providers: state?.providers ?? [],
        });
      }
      if (url.pathname === MCP_PATH) {
        return handleMcp(request);
      }
      if (url.pathname === RELAY_PATH) {
        const token = readBearerToken(request);
        const user = token ? options.tokens.resolveRelayToken(token) : null;
        if (!user) return bearerUnauthorized();
        const upgraded = bunServer.upgrade(request, { data: { userId: user.userId } });
        if (!upgraded) return new Response("Upgrade failed", { status: 400 });
        return undefined;
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(socket) {
        relayHub.acceptRelay(socket.data.userId, socket);
      },
      message(socket, message) {
        try {
          const raw = typeof message === "string" ? message : message.toString();
          relayHub.handleRelayFrame(socket.data.userId, JSON.parse(raw) as Up);
        } catch (error) {
          logger.error("[slop-bridge] invalid relay frame", error instanceof Error ? error.message : String(error));
          socket.close(4001, "invalid relay frame");
        }
      },
      close(socket) {
        relayHub.closeRelay(socket.data.userId);
      },
    },
  });

  return {
    port: server.port,
    url: server.url.toString(),
    relayHub,
    stop() {
      for (const sessionId of [...sessions.keys()]) {
        void closeSession(sessionId);
      }
      server.stop(true);
    },
  };
}
