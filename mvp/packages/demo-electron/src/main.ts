import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  createState, addTask, toggleTask, editTask, deleteTask,
  startPomodoro, stopPomodoro, tickPomodoro,
} from "./state";
import { buildTree } from "./tree";
import type { SlopNode } from "@slop/types";

// --- Config ---
const SLOP_PORT = Number(process.env.SLOP_PORT) || 3838;

// --- State ---
const state = createState();
let win: BrowserWindow | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;

// --- SLOP WebSocket server ---
// Electron runs on Node, so we use the ws package isn't available.
// We'll use a simple HTTP server with WebSocket upgrade via the built-in approach.
// Actually, let's use a minimal WS implementation on top of Node's http module.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/.well-known/slop") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "slop-pomodoro",
      name: "Pomodoro Tracker",
      slop_version: "0.1",
      transport: { type: "ws", url: `ws://localhost:${SLOP_PORT}/slop` },
      capabilities: ["state", "patches", "affordances"],
    }));
    return;
  }
  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ noServer: true });

// Track SLOP subscriptions per client
const slopSubs = new Map<WebSocket, Map<string, { path: string; depth: number }>>();
let slopVersion = 0;

httpServer.on("upgrade", (req, socket, head) => {
  if (req.url === "/slop") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  // Send hello
  ws.send(JSON.stringify({
    type: "hello",
    provider: {
      id: "slop-pomodoro",
      name: "Pomodoro Tracker",
      slop_version: "0.1",
      capabilities: ["state", "patches", "affordances"],
    },
  }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      handleSlopMessage(ws, msg);
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });

  ws.on("close", () => {
    slopSubs.delete(ws);
  });
});

function handleSlopMessage(ws: WebSocket, msg: any) {
  switch (msg.type) {
    case "subscribe": {
      if (!slopSubs.has(ws)) slopSubs.set(ws, new Map());
      slopSubs.get(ws)!.set(msg.id, { path: msg.path ?? "/", depth: msg.depth ?? -1 });
      ws.send(JSON.stringify({
        type: "snapshot",
        id: msg.id,
        version: slopVersion,
        tree: buildTree(state),
      }));
      break;
    }
    case "unsubscribe": {
      slopSubs.get(ws)?.delete(msg.id);
      break;
    }
    case "query": {
      ws.send(JSON.stringify({
        type: "snapshot",
        id: msg.id,
        version: slopVersion,
        tree: buildTree(state),
      }));
      break;
    }
    case "invoke": {
      try {
        const result = handleInvoke(msg.path, msg.action, msg.params ?? {});
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

function handleInvoke(path: string, action: string, params: Record<string, unknown>): unknown {
  let desc: string;
  const segments = path.split("/").filter(Boolean);
  const taskId = segments.find(s => s.startsWith("task-")) ?? "";

  switch (action) {
    case "add_task":
      desc = addTask(state, params.title as string);
      break;
    case "toggle":
      desc = toggleTask(state, taskId);
      break;
    case "edit":
      desc = editTask(state, taskId, params.title as string);
      break;
    case "delete":
      desc = deleteTask(state, taskId);
      break;
    case "start_pomodoro":
      desc = startPomodoro(state, taskId);
      startTimer();
      break;
    case "stop":
      desc = stopPomodoro(state);
      stopTimer();
      break;
    default:
      throw { code: "not_found", message: `Unknown action: ${action}` };
  }

  syncAll("agent", desc);
  return { success: true };
}

function broadcastSlopState() {
  slopVersion++;
  const tree = buildTree(state);
  for (const [ws, subs] of slopSubs) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    for (const [subId] of subs) {
      try {
        ws.send(JSON.stringify({ type: "snapshot", id: subId, version: slopVersion, tree }));
      } catch {}
    }
  }
}

function syncAll(source: "browser" | "agent", message: string) {
  broadcastSlopState();
  // Update Electron renderer
  if (win && !win.isDestroyed()) {
    win.webContents.send("state-update", state);
    win.webContents.send("activity", { source, message, time: new Date().toISOString() });
  }
  console.log(`[${source}] ${message}`);
}

// --- Timer ---

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    const result = tickPomodoro(state);
    // Send timer tick to renderer for live countdown
    if (win && !win.isDestroyed()) {
      win.webContents.send("state-update", state);
    }
    // Broadcast to SLOP clients every 5 seconds (not every tick)
    if (state.pomodoro.remaining % 5 === 0) {
      broadcastSlopState();
    }
    if (result.finished) {
      syncAll("browser", result.message!);
      if (state.pomodoro.status === "idle") {
        stopTimer();
      }
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- IPC handlers (from renderer) ---

ipcMain.on("action", (_event, msg: any) => {
  try {
    let desc: string;
    switch (msg.type) {
      case "add_task":
        desc = addTask(state, msg.title);
        break;
      case "toggle":
        desc = toggleTask(state, msg.taskId);
        break;
      case "edit":
        desc = editTask(state, msg.taskId, msg.title);
        break;
      case "delete":
        desc = deleteTask(state, msg.taskId);
        break;
      case "start_pomodoro":
        desc = startPomodoro(state, msg.taskId);
        startTimer();
        break;
      case "stop":
        desc = stopPomodoro(state);
        stopTimer();
        break;
      default:
        return;
    }
    syncAll("browser", desc);
  } catch (err: any) {
    console.error("Action error:", err.message);
  }
});

ipcMain.handle("get-state", () => state);

// --- Electron window ---

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 500,
    minHeight: 400,
    title: "Pomodoro Tracker",
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(join(__dirname, "..", "public", "index.html"));
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();

  httpServer.listen(SLOP_PORT, () => {
    console.log(`Pomodoro Tracker running:`);
    console.log(`  SLOP:  ws://localhost:${SLOP_PORT}/slop`);
    console.log(`  Discovery: http://localhost:${SLOP_PORT}/.well-known/slop`);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopTimer();
  httpServer.close();
  if (process.platform !== "darwin") app.quit();
});
