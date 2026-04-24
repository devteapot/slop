// Iframe bundle — runs inside the sandboxed MCP Apps view.
//
// Connects (over WebSocket) to the SLOP provider that the MCP server hosts in
// the same process. The bridge handles the model-context projection; this file
// only renders the visible UI from the consumer's mirrored tree.

import { createMcpAppsBridge } from "@slop-ai/mcp-apps-bridge";
import type { SlopNode } from "@slop-ai/consumer/browser";

const SLOP_URL = "ws://127.0.0.1:7411/slop";

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function render(tree: SlopNode | null): void {
  const root = document.getElementById("root");
  if (!root) return;
  if (!tree) {
    root.innerHTML = `<p>Connecting to SLOP provider…</p>`;
    return;
  }
  const cols = tree.children ?? [];
  root.innerHTML = `
    <h1>Kanban — SLOP inside MCP Apps</h1>
    <div class="cols">
      ${cols
        .map((col) => {
          const title = (col.properties?.title as string) ?? col.id;
          const items = col.children ?? [];
          return `
            <div class="col">
              <h2>${escape(title)} (${items.length})</h2>
              <ul>
                ${items
                  .map((c) => {
                    const cardTitle = (c.properties?.title as string) ?? c.id;
                    const done = c.properties?.done === true;
                    return `<li class="${done ? "done" : ""}">${escape(cardTitle)}</li>`;
                  })
                  .join("")}
              </ul>
            </div>`;
        })
        .join("")}
    </div>`;
}

const bridge = await createMcpAppsBridge({
  provider: { mode: "ws", url: SLOP_URL },
  subscribe: { depth: -1, minSalience: 0.3 },
  projection: { header: "# Kanban — live state from the iframe" },
  appInfo: { name: "mcp-apps-bridge-demo", version: "0.1.1" },
});

render(bridge.getTree());
bridge.consumer.on("patch", () => render(bridge.getTree()));
