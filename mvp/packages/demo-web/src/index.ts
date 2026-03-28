import { SlopProvider, UnixServerTransport } from "@slop/provider";
import { createBoard, addCard, moveCard, editCard, deleteCard, clearColumn } from "./state";
import { buildTree } from "./tree";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ServerWebSocket } from "bun";

// --- Config ---
const PORT = Number(process.env.PORT) || 3737;
const SOCKET_PATH = "/tmp/slop/slop-kanban.sock";

mkdirSync("/tmp/slop", { recursive: true });

// --- Shared state ---
const board = createBoard();
const wsClients = new Set<ServerWebSocket<unknown>>();
const slopWsClients = new Set<ServerWebSocket<unknown>>();

// --- SLOP provider ---
const provider = new SlopProvider({
  id: "slop-kanban",
  name: "SLOP Kanban Board",
  capabilities: ["state", "patches", "affordances"],
  transport: new UnixServerTransport(SOCKET_PATH),
  register: true,
});

provider.setTree(buildTree(board));

// SLOP WebSocket state (used by rebuildAndSync)
const slopWsSubs = new Map<ServerWebSocket<unknown>, Map<string, { path: string; depth: number }>>();
let slopVersion = 0;

function broadcastSlopState() {
  slopVersion++;
  const tree = buildTree(board);
  for (const [ws, subs] of slopWsSubs) {
    for (const [subId] of subs) {
      try {
        ws.send(JSON.stringify({ type: "snapshot", id: subId, version: slopVersion, tree }));
      } catch {}
    }
  }
}

function rebuildAndSync(source: "browser" | "agent", message: string) {
  provider.setTree(buildTree(board));
  broadcastState();
  broadcastActivity(source, message);
  broadcastSlopState();
  console.log(`[${source}] ${message}`);
}

function broadcastState() {
  const msg = JSON.stringify({ type: "state", board });
  for (const ws of wsClients) {
    ws.send(msg);
  }
}

function broadcastActivity(source: "browser" | "agent", message: string) {
  const msg = JSON.stringify({ type: "activity", source, message, time: new Date().toISOString() });
  for (const ws of wsClients) {
    ws.send(msg);
  }
}

// --- SLOP affordance handlers ---

provider.onInvoke("add_card", (params) => {
  const msg = addCard(board, params.column as string, params.title as string, params.description as string, params.color as string);
  rebuildAndSync("agent", msg);
  return { success: true };
});

provider.onInvoke("move", (params, path) => {
  const cardId = path.split("/").pop()!;
  const msg = moveCard(board, cardId, params.to_column as string);
  rebuildAndSync("agent", msg);
});

provider.onInvoke("edit", (params, path) => {
  const cardId = path.split("/").pop()!;
  const msg = editCard(board, cardId, params as any);
  rebuildAndSync("agent", msg);
});

provider.onInvoke("delete", (_params, path) => {
  const cardId = path.split("/").pop()!;
  const msg = deleteCard(board, cardId);
  rebuildAndSync("agent", msg);
});

provider.onInvoke("clear_column", (_params, path) => {
  const columnId = path.split("/").filter(Boolean).at(-1)!;
  const msg = clearColumn(board, columnId);
  rebuildAndSync("agent", msg);
});

// --- HTML ---
const htmlPath = join(import.meta.dir, "..", "public", "index.html");
const html = readFileSync(htmlPath, "utf-8");

// --- Bun HTTP + WebSocket server ---

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrades
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { type: "app" } })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/slop") {
      if (server.upgrade(req, { data: { type: "slop" } })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Well-known SLOP discovery endpoint
    if (url.pathname === "/.well-known/slop") {
      return Response.json({
        id: "slop-kanban",
        name: "SLOP Kanban Board",
        slop_version: "0.1",
        transport: { type: "ws", url: `ws://localhost:${PORT}/slop` },
        capabilities: ["state", "patches", "affordances"],
      });
    }

    // Serve HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const data = (ws.data as any);
      if (data?.type === "slop") {
        slopWsClients.add(ws);
        // Send SLOP hello
        ws.send(JSON.stringify({
          type: "hello",
          provider: {
            id: "slop-kanban",
            name: "SLOP Kanban Board",
            slop_version: "0.1",
            capabilities: ["state", "patches", "affordances"],
          },
        }));
        return;
      }
      // App WebSocket
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: "state", board }));
    },
    message(ws, raw) {
      const data = (ws.data as any);
      try {
        const msg = JSON.parse(String(raw));
        if (data?.type === "slop") {
          handleSlopMessage(ws, msg);
        } else {
          handleBrowserAction(msg);
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", message: err.message ?? String(err) }));
      }
    },
    close(ws) {
      const data = (ws.data as any);
      if (data?.type === "slop") {
        slopWsClients.delete(ws);
        slopWsSubs.delete(ws);
      } else {
        wsClients.delete(ws);
      }
    },
  },
});

function handleBrowserAction(msg: any) {
  switch (msg.type) {
    case "add_card": {
      const desc = addCard(board, msg.columnId, msg.title, msg.description, msg.color);
      rebuildAndSync("browser", desc);
      break;
    }
    case "move_card": {
      const desc = moveCard(board, msg.cardId, msg.toColumnId);
      rebuildAndSync("browser", desc);
      break;
    }
    case "edit_card": {
      const desc = editCard(board, msg.cardId, msg);
      rebuildAndSync("browser", desc);
      break;
    }
    case "delete_card": {
      const desc = deleteCard(board, msg.cardId);
      rebuildAndSync("browser", desc);
      break;
    }
  }
}

// --- SLOP WebSocket handler ---

function handleSlopMessage(ws: ServerWebSocket<unknown>, msg: any) {
  switch (msg.type) {
    case "subscribe": {
      if (!slopWsSubs.has(ws)) slopWsSubs.set(ws, new Map());
      slopWsSubs.get(ws)!.set(msg.id, { path: msg.path ?? "/", depth: msg.depth ?? -1 });
      ws.send(JSON.stringify({
        type: "snapshot",
        id: msg.id,
        version: slopVersion,
        tree: buildTree(board),
      }));
      break;
    }
    case "unsubscribe": {
      slopWsSubs.get(ws)?.delete(msg.id);
      break;
    }
    case "query": {
      ws.send(JSON.stringify({
        type: "snapshot",
        id: msg.id,
        version: slopVersion,
        tree: buildTree(board),
      }));
      break;
    }
    case "invoke": {
      try {
        const result = handleSlopInvoke(msg.path, msg.action, msg.params ?? {});
        ws.send(JSON.stringify({ type: "result", id: msg.id, status: "ok", data: result }));
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: "result", id: msg.id, status: "error",
          error: { code: err.code ?? "internal", message: err.message ?? String(err) },
        }));
      }
      break;
    }
  }
}

function handleSlopInvoke(path: string, action: string, params: Record<string, unknown>): unknown {
  let desc: string;
  switch (action) {
    case "add_card":
      desc = addCard(board, params.column as string, params.title as string, params.description as string, params.color as string);
      break;
    case "move":
      desc = moveCard(board, path.split("/").pop()!, params.to_column as string);
      break;
    case "edit":
      desc = editCard(board, path.split("/").pop()!, params as any);
      break;
    case "delete":
      desc = deleteCard(board, path.split("/").pop()!);
      break;
    case "clear_column":
      desc = clearColumn(board, path.split("/").filter(Boolean).at(-1)!);
      break;
    default:
      throw { code: "not_found", message: `Unknown action: ${action}` };
  }
  rebuildAndSync("agent", desc);
  // Send patches to all SLOP WS subscribers
  broadcastSlopState();
  return { success: true };
}

// --- Start SLOP provider ---
await provider.start();

console.log(`Kanban board running:`);
console.log(`  Browser:  http://localhost:${PORT}`);
console.log(`  SLOP:     ${SOCKET_PATH}`);
console.log(`  Agent:    bun run demo:agent -- slop-kanban`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await provider.stop();
  server.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await provider.stop();
  server.stop();
  process.exit(0);
});
