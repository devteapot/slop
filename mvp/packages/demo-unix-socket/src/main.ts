import { app, BrowserWindow, ipcMain, clipboard } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SlopProvider, UnixServerTransport } from "@slop/provider";
import {
  createState, addEntry, toggleFavorite, deleteEntry,
  clearHistory, copyToClipboard,
} from "./state";
import { buildTree } from "./tree";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const SOCKET_PATH = "/tmp/slop/slop-clipboard-manager.sock";

// --- State ---
const state = createState();
let win: BrowserWindow | null = null;
let clipboardPollInterval: ReturnType<typeof setInterval> | null = null;
let lastClipboardText = "";

// --- SLOP provider (Unix socket) ---
const provider = new SlopProvider({
  id: "slop-clipboard-manager",
  name: "Clipboard Manager",
  capabilities: ["state", "patches", "affordances"],
  transport: new UnixServerTransport(SOCKET_PATH),
  register: true,
});

provider.setTree(buildTree(state));

// --- Affordance handlers ---

provider.onInvoke("add_entry", (params) => {
  const msg = addEntry(state, params.text as string);
  if (msg) syncAll("agent", msg);
  return { success: true };
});

provider.onInvoke("copy_to_clipboard", (_params, path) => {
  const entryId = path.split("/").filter(Boolean).pop()!;
  const msg = copyToClipboard(state, entryId);
  lastClipboardText = clipboard.readText(); // Prevent re-capture
  syncAll("agent", msg);
  return { success: true };
});

provider.onInvoke("favorite", (_params, path) => {
  const entryId = path.split("/").filter(Boolean).pop()!;
  const msg = toggleFavorite(state, entryId);
  syncAll("agent", msg);
  return { success: true };
});

provider.onInvoke("unfavorite", (_params, path) => {
  const entryId = path.split("/").filter(Boolean).pop()!;
  const msg = toggleFavorite(state, entryId);
  syncAll("agent", msg);
  return { success: true };
});

provider.onInvoke("delete", (_params, path) => {
  const entryId = path.split("/").filter(Boolean).pop()!;
  const msg = deleteEntry(state, entryId);
  syncAll("agent", msg);
  return { success: true };
});

provider.onInvoke("clear_history", () => {
  const msg = clearHistory(state);
  syncAll("agent", msg);
  return { success: true };
});

// --- Sync ---

function syncAll(source: "browser" | "agent", message: string) {
  provider.setTree(buildTree(state));
  if (win && !win.isDestroyed()) {
    win.webContents.send("state-update", state);
    win.webContents.send("activity", { source, message, time: new Date().toISOString() });
  }
  console.log(`[${source}] ${message}`);
}

// --- Clipboard polling ---

function startClipboardPoll() {
  lastClipboardText = clipboard.readText();
  clipboardPollInterval = setInterval(() => {
    const text = clipboard.readText();
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
      const msg = addEntry(state, text);
      if (msg) syncAll("browser", msg);
    }
  }, 2000);
}

function stopClipboardPoll() {
  if (clipboardPollInterval) {
    clearInterval(clipboardPollInterval);
    clipboardPollInterval = null;
  }
}

// --- IPC handlers ---

ipcMain.on("action", (_event, msg: any) => {
  try {
    let desc: string | null;
    switch (msg.type) {
      case "add_entry":
        desc = addEntry(state, msg.text);
        break;
      case "copy_to_clipboard":
        desc = copyToClipboard(state, msg.entryId);
        lastClipboardText = clipboard.readText();
        break;
      case "favorite":
      case "unfavorite":
        desc = toggleFavorite(state, msg.entryId);
        break;
      case "delete":
        desc = deleteEntry(state, msg.entryId);
        break;
      case "clear_history":
        desc = clearHistory(state);
        break;
      default:
        return;
    }
    if (desc) syncAll("browser", desc);
  } catch (err: any) {
    console.error("Action error:", err.message);
  }
});

ipcMain.handle("get-state", () => state);

// --- Electron window ---

function createWindow() {
  win = new BrowserWindow({
    width: 700,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    title: "Clipboard Manager",
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

app.whenReady().then(async () => {
  createWindow();
  startClipboardPoll();

  await provider.start();
  console.log(`Clipboard Manager running:`);
  console.log(`  SLOP: ${SOCKET_PATH}`);
  console.log(`  Discovery: ~/.slop/providers/slop-clipboard-manager.json`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  stopClipboardPoll();
  await provider.stop();
  if (process.platform !== "darwin") app.quit();
});

process.on("SIGINT", async () => {
  stopClipboardPoll();
  await provider.stop();
  process.exit(0);
});
