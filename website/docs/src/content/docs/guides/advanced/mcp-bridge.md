---
title: "MCP Apps Bridge"
description: "Render a SLOP provider inside an MCP Apps host (VS Code, Claude, Goose) with model-callable affordances"
---
Expose a SLOP provider inside an MCP Apps host (Claude, ChatGPT, Goose, VS Code Insiders) so the host model can subscribe to live state and call your app's affordances directly from chat.

The `@slop-ai/mcp-apps-bridge` package handles three things:

- **Iframe-side bridge** — runs inside the sandboxed `ui://` view, opens a SLOP consumer, projects salience-filtered state into `app.updateModelContext`.
- **`registerSlopView`** — server-side helper that wires the MCP tool + `ui://` resource + sandbox CSP.
- **`registerSlopTools`** — server-side helper that mirrors every SLOP affordance as a callable MCP tool, with `tools/listChanged` resync on every patch.

This guide is the developer-facing complement to the normative [MCP Interoperability spec](../../../spec/integrations/mcp.md). For an end-to-end runnable example, see [`examples/mcp-apps-bridge`](https://github.com/devteapot/slop/tree/main/examples/mcp-apps-bridge).

## When to use this

- Your users interact with SLOP-aware apps through a chat UI (Claude / VS Code chat / Goose / etc.) and you want the model to both *observe* state and *act* on it inside the same conversation.
- You already have a SLOP provider — adding the bridge is a server file plus an iframe bundle.

If your target host doesn't support MCP Apps yet, use the [Claude Code integration](/guides/advanced/claude-code) (proxy pattern) instead.

## Architecture

```
┌─ host (VS Code Insiders / Claude / Goose) ─────────────────────────┐
│                                                                     │
│   MCP client ──stdio──▶ MCP server                                  │
│        │                  │                                          │
│        │                  ├── SLOP provider (yours)                 │
│        │                  │                                          │
│        │                  ├── registerSlopView  ── tool + ui://     │
│        │                  └── registerSlopTools ── one MCP tool     │
│        │                                              per affordance │
│        ▼                                                             │
│   sandboxed iframe (open_*your_view*)                                │
│        │                                                             │
│        └── createMcpAppsBridge ──ws──▶ same SLOP provider           │
│              ├── consumer mirrors tree                               │
│              ├── projector → app.updateModelContext (debounced)     │
│              └── you render UI from consumer.getTree()              │
└─────────────────────────────────────────────────────────────────────┘
```

A single Node process typically hosts the SLOP provider, the MCP server, and the WS endpoint. The iframe is a thin client.

## Server: register the view + the tools

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerSlopView,
  registerSlopTools,
} from "@slop-ai/mcp-apps-bridge/server";
import { createSlopServer } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";
import { readFile } from "node:fs/promises";

const PORT = 7411;
const slop = createSlopServer({ id: "kanban", name: "Kanban" });
// register your nodes + actions on slop ...

// Expose the SLOP provider over WebSocket (Bun example; use attachSlop for Node).
const slopHandler = bunHandler(slop, { path: "/slop" });
Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    return slopHandler.fetch(req, srv) ?? new Response("ok");
  },
  websocket: slopHandler.websocket,
});

const RESOURCE_URI = "ui://my-app/view";
const mcp = new McpServer(
  { name: "my-app", version: "0.1.0" },
  { capabilities: { tools: { listChanged: true }, resources: {} } },
);

registerSlopView(mcp, {
  toolName: "open_kanban",
  description: "Open a live view of the kanban board",
  resourceUri: RESOURCE_URI,
  resourceName: "Kanban View",
  html: () => readFile(new URL("./dist/iframe.html", import.meta.url), "utf8"),
  // CRITICAL for sandboxed hosts: whitelist the SLOP provider's WS origin.
  // Without this, VS Code's webview blocks the iframe's WS connection.
  connectDomains: [`ws://127.0.0.1:${PORT}`],
});

await registerSlopTools(mcp, {
  url: `ws://127.0.0.1:${PORT}/slop`,
  uiResourceUri: RESOURCE_URI, // tags every tool with the iframe surface
});

await mcp.connect(new StdioServerTransport());
```

What `registerSlopTools` does: connects to the SLOP provider as a consumer, walks the affordances via `affordancesToTools`, and registers one MCP tool per `(action, schema)` group (so 1000 cards each with a `delete` affordance produce **one** `delete` MCP tool with a `target` parameter, not 1000). Resyncs on every patch and emits `tools/listChanged`.

## Iframe: render + project

The iframe bundle is plain HTML/JS served by `registerSlopView`. Bundle it however you like (Bun, Vite, esbuild) — the demo uses a single-file HTML wrapper.

```ts
import { createMcpAppsBridge } from "@slop-ai/mcp-apps-bridge";
import type { SlopNode } from "@slop-ai/consumer/browser";

const bridge = await createMcpAppsBridge({
  provider: { mode: "ws", url: "ws://127.0.0.1:7411/slop" },
  subscribe: { depth: -1, minSalience: 0.3 },
  projection: { header: "# Kanban — live state from the iframe" },
});

// Render UI from the consumer's mirrored tree.
function render(tree: SlopNode | null) { /* your DOM updates */ }
render(bridge.getTree());
bridge.consumer.on("patch", () => render(bridge.getTree()));
```

The bridge's other mode is `{ mode: "postmessage" }` for client-only setups where the SLOP provider runs inside the iframe via `@slop-ai/client`. Use `ws` mode whenever there's a server-side authoritative state.

## Provider modes

| Mode | When to use | Tradeoffs |
|---|---|---|
| `ws` | Server-side authoritative state. The MCP server, SLOP provider, and tool-registering consumer all run in one process. | Requires `connectDomains` for sandboxed hosts. The architecture every non-toy app wants. |
| `postmessage` | Client-only / no backend. SLOP provider lives in the iframe via `@slop-ai/client`. | Model can't act on state via `registerSlopTools` (server has no consumer to discover affordances from). State is iframe-local. |

## How the model sees state

The bridge calls `app.updateModelContext` with a debounced markdown projection of the salience-filtered tree on every snapshot/patch. The projection includes the state tree (via `formatTree`) **and** the affordance list (via `affordancesToTools`). The model receives this in context on the *next* turn after the iframe opens — so the very first response after `open_*` won't see state yet, but every subsequent turn will.

To validate: open the view, then ask a question whose answer depends on tree contents. The model should answer without making another tool call.

## Caveats and known gotchas

- **Sandboxed network.** Hosts like VS Code's webview default to "no network." If you don't pass `connectDomains` to `registerSlopView`, your `ws` iframe will silently fail to connect. The bridge surfaces this as `error: WebSocket connection failed` in the iframe status line if you wrap `createMcpAppsBridge` in a try/catch.
- **First-turn latency.** `app.updateModelContext` lands asynchronously after the tool returns. The model that just called `open_*` won't see state until its next turn.
- **Tool descriptions inline param info.** The MCP SDK only accepts Zod schemas for `inputSchema`, not raw JSON Schema. `registerSlopTools` works around this with a permissive passthrough schema and stuffs the SLOP affordance's params + valid `target` paths into the tool *description*. The model handles this fine; future versions will convert SLOP JSON Schema → Zod for proper validation.
- **`tools/list_changed` is chatty.** Currently fires once per patch resync; in apps with high patch frequency, consider widening the bridge's resync debounce (PRs welcome).
- **Big trees flood context.** The default projection ships the entire salience-filtered tree as markdown on every patch. For apps with thousands of nodes use a stricter `subscribe.minSalience` and a custom `projection.format` that summarizes rather than emits every node. See the [scaling extension](/spec/extensions/scaling).

## Security

The host's iframe sandbox and user-consent prompts are defense in depth. They are **not** the authorization boundary. Your SLOP provider must re-authorize every affordance invocation against live state and caller identity, exactly as it would for a direct WebSocket consumer.

For remote providers (production), use a short-lived token in the WS URL minted per-session by your backend. Don't put bearer tokens in MCP tool `content` or anywhere model-visible — they end up in conversation transcripts.

## Validating in real hosts

The smoke test we use:

1. Build the demo: `cd examples/mcp-apps-bridge && bun run build`.
2. Register the server in **VS Code Insiders** (Cmd+Shift+P → `MCP: Open User Configuration`):
   ```jsonc
   {
     "servers": {
       "slop-kanban": {
         "type": "stdio",
         "command": "bun",
         "args": ["<absolute-path-to>/dist/server.js"]
       }
     }
   }
   ```
3. Reload the window, open Copilot Chat, ask: `Use the open_kanban tool`. The iframe should render with status `connected`.
4. Ask: `What cards are in todo?` — model should answer without another tool call.
5. Ask: `Add a card called "Ship it" to todo` — the model calls `add_card`, the iframe re-renders, and the next turn's context reflects the new card.

If the iframe shows `error: WebSocket connection failed`, the most common cause is missing `connectDomains` (or VS Code holding a cached MCP server connection — Stop + Start the server in `MCP: List Servers`).

## Future direction

When MCP standardizes event-driven resource subscriptions (tracked in the [2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)), the bridge will offer a third `mode: "mcp-tunnel"` that doesn't require the iframe to open a WebSocket — all SLOP traffic flows over MCP's own subscription channel. Until then, `ws` + `connectDomains` is the recommended pattern. See the ["No formal MCP extension" entry](/spec/limitations#no-formal-mcp-extension) for the planned SEP.
