// Iframe bundle — runs inside the sandboxed MCP Apps view.
//
// 1. Boots a tiny in-iframe SLOP provider via @slop-ai/client (postMessage transport).
// 2. Uses @slop-ai/mcp-apps-bridge to consume it and push salience-filtered
//    markdown projections into the host model through ext-apps' App.

import { createSlop, action } from "@slop-ai/client";
import { createMcpAppsBridge } from "@slop-ai/mcp-apps-bridge";

type Card = { id: string; title: string; done: boolean };
type Column = { id: "todo" | "doing" | "done"; title: string; cards: Card[] };

const state: { columns: Column[] } = {
  columns: [
    { id: "todo", title: "Todo", cards: [{ id: "c1", title: "Wire bridge", done: false }] },
    { id: "doing", title: "Doing", cards: [{ id: "c2", title: "Write demo", done: false }] },
    { id: "done", title: "Done", cards: [] },
  ],
};

const slop = createSlop({ id: "mcp-apps-bridge-demo", name: "MCP Apps Bridge Demo" });

function registerAll() {
  for (const col of state.columns) {
    slop.register(col.id, {
      type: "group",
      props: { title: col.title, count: col.cards.length },
      meta: { salience: col.cards.length > 0 ? 0.8 : 0.4 },
      actions: {
        add_card: action(
          { title: "string" } as const,
          ({ title }) => {
            col.cards.push({ id: `c${Date.now()}`, title, done: false });
            registerAll();
            renderUI();
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
              renderUI();
            },
            { idempotent: true, label: "Toggle done" },
          ),
          delete: action(
            () => {
              col.cards = col.cards.filter((x) => x.id !== c.id);
              registerAll();
              renderUI();
            },
            { dangerous: true, label: "Delete" },
          ),
        },
      })),
    });
  }
}

function renderUI() {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <h1>Kanban — SLOP inside MCP Apps</h1>
    <div class="cols">
      ${state.columns
        .map(
          (col) => `
        <div class="col">
          <h2>${col.title} (${col.cards.length})</h2>
          <ul>${col.cards
            .map((c) => `<li class="${c.done ? "done" : ""}">${escape(c.title)}</li>`)
            .join("")}</ul>
        </div>`,
        )
        .join("")}
    </div>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

registerAll();
renderUI();

void createMcpAppsBridge({
  provider: { mode: "postmessage" },
  subscribe: { depth: -1, minSalience: 0.3 },
  projection: { header: "# Kanban — live state from the iframe" },
  appInfo: { name: "mcp-apps-bridge-demo", version: "0.1.0" },
});
