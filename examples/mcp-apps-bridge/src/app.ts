// Iframe bundle — runs inside the sandboxed MCP Apps view.
//
// Connects (over WebSocket) to the SLOP provider that the MCP server hosts in
// the same process. The bridge handles the model-context projection; this file
// only renders the visible UI from the consumer's mirrored tree.

import type { SlopNode } from "@slop-ai/consumer/browser";
import { createMcpAppsBridge } from "@slop-ai/mcp-apps-bridge";

const SLOP_URL = "ws://127.0.0.1:7411/slop";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function setStatus(text: string): void {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

function render(tree: SlopNode | null): void {
  const root = document.getElementById("board");
  if (!root) return;
  if (!tree) {
    root.innerHTML = `<p style="opacity:.6">waiting for snapshot…</p>`;
    return;
  }
  const cols = tree.children ?? [];
  if (cols.length === 0) {
    root.innerHTML = `<p style="opacity:.6">tree present but no columns yet (root has no children)</p>`;
    return;
  }
  root.innerHTML = `
    <div class="cols">
      ${cols
        .map((col) => {
          const title = (col.properties?.title as string) ?? col.id;
          const items = col.children ?? [];
          return `
            <div class="col">
              <h2>${escapeHtml(title)} (${items.length})</h2>
              <ul>
                ${items
                  .map((c) => {
                    const cardTitle = (c.properties?.title as string) ?? c.id;
                    const done = c.properties?.done === true;
                    return `<li class="${done ? "done" : ""}">${escapeHtml(cardTitle)}</li>`;
                  })
                  .join("")}
              </ul>
            </div>`;
        })
        .join("")}
    </div>`;
}

// Render the shell immediately so the iframe is never visually blank, even if
// the WS connect hangs or throws.
render(null);
setStatus("connecting…");

try {
  const bridge = await createMcpAppsBridge({
    provider: { mode: "ws", url: SLOP_URL },
    subscribe: { depth: -1, minSalience: 0.3 },
    projection: { header: "# Kanban — live state from the iframe" },
    appInfo: { name: "mcp-apps-bridge-demo", version: "0.1.1" },
  });

  setStatus("connected");
  render(bridge.getTree());
  bridge.consumer.on("patch", () => render(bridge.getTree()));
} catch (err) {
  setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error("[mcp-apps-bridge-demo] bridge init failed:", err);
}
