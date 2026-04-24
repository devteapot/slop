// Single-process demo:
// - Bun.serve hosts a SLOP provider over WebSocket on /slop.
// - The same process runs an MCP stdio server.
// - registerSlopView exposes `open_kanban` (the iframe surface).
// - registerSlopTools mirrors the SLOP affordances as MCP tools, so the
//   model can act on the board from chat (not just observe it).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerSlopTools,
  registerSlopView,
} from "@slop-ai/mcp-apps-bridge/server";
import { createSlopServer, action } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- SLOP provider (server-side state) -------------------------------------

type Card = { id: string; title: string; done: boolean };
type Column = { id: "todo" | "doing" | "done"; title: string; cards: Card[] };

const state: { columns: Column[] } = {
  columns: [
    { id: "todo", title: "Todo", cards: [{ id: "c1", title: "Wire bridge", done: false }] },
    { id: "doing", title: "Doing", cards: [{ id: "c2", title: "Write demo", done: false }] },
    { id: "done", title: "Done", cards: [] },
  ],
};

const slop = createSlopServer({ id: "mcp-apps-bridge-demo", name: "MCP Apps Bridge Demo" });

function registerAll() {
  for (const col of state.columns) {
    slop.register(col.id, () => ({
      type: "group",
      props: { title: col.title, count: col.cards.length },
      meta: { salience: col.cards.length > 0 ? 0.8 : 0.4 },
      actions: {
        add_card: action(
          { title: "string" } as const,
          ({ title }) => {
            col.cards.push({ id: `c${Date.now()}`, title, done: false });
            registerAll();
          },
          { label: `Add card to ${col.title}` },
        ),
      },
      items: col.cards.map((c) => ({
        id: c.id,
        props: { title: c.title, done: c.done },
        meta: { salience: c.done ? 0.3 : 0.7 },
        actions: {
          toggle: action(
            () => {
              c.done = !c.done;
              registerAll();
            },
            { idempotent: true, label: "Toggle done" },
          ),
          delete: action(
            () => {
              col.cards = col.cards.filter((x) => x.id !== c.id);
              registerAll();
            },
            { dangerous: true, label: "Delete" },
          ),
        },
      })),
    }));
  }
}
registerAll();

// --- WS transport -----------------------------------------------------------

const PORT = Number(process.env.SLOP_PORT ?? 7411);
const slopHandler = bunHandler(slop as never, { path: "/slop" });

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const resp = slopHandler.fetch(req, srv);
    if (resp) return resp;
    return new Response("ok");
  },
  websocket: slopHandler.websocket,
});

// --- MCP server -------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const iframePath = join(here, "iframe.html");
const RESOURCE_URI = "ui://mcp-apps-bridge-demo/kanban";

const mcp = new McpServer(
  { name: "mcp-apps-bridge-demo", version: "0.1.1" },
  { capabilities: { tools: { listChanged: true }, resources: {} } },
);

registerSlopView(mcp, {
  toolName: "open_kanban",
  description: "Open a live view of the SLOP-backed kanban board",
  resourceUri: RESOURCE_URI,
  resourceName: "Kanban View",
  html: () => readFile(iframePath, "utf8"),
  // Sandboxed iframes (VS Code webview, etc.) block all network by default.
  // Whitelist the local SLOP provider so the iframe can subscribe over WS.
  connectDomains: [`ws://127.0.0.1:${PORT}`],
});

await registerSlopTools(mcp, {
  url: `ws://127.0.0.1:${PORT}/slop`,
  uiResourceUri: RESOURCE_URI,
});

await mcp.connect(new StdioServerTransport());
