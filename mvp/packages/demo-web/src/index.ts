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

// --- SLOP provider ---
const provider = new SlopProvider({
  id: "slop-kanban",
  name: "SLOP Kanban Board",
  capabilities: ["state", "patches", "affordances"],
  transport: new UnixServerTransport(SOCKET_PATH),
  register: true,
});

provider.setTree(buildTree(board));

function rebuildAndSync(source: "browser" | "agent", message: string) {
  provider.setTree(buildTree(board));
  broadcastState();
  broadcastActivity(source, message);
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

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
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
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: "state", board }));
    },
    message(ws, raw) {
      try {
        const msg = JSON.parse(String(raw));
        handleBrowserAction(msg);
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", message: err.message ?? String(err) }));
      }
    },
    close(ws) {
      wsClients.delete(ws);
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
