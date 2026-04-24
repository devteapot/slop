# mcp-apps-bridge demo

End-to-end example: a stdio MCP server exposing a single `open_kanban` tool. The tool opens a sandboxed iframe (served as a `ui://` resource) that runs an in-iframe SLOP provider + `@slop-ai/mcp-apps-bridge`. Subscribing, snapshots, patches, and affordance invocations all round-trip through the bridge; salience-filtered markdown projections reach the host model via `app.updateModelContext`.

## Build & run

```bash
bun install
bun run build
```

## Connect a host

**MCP Inspector** (quickest smoke test):

```bash
bunx @modelcontextprotocol/inspector bun dist/server.js
```

**VS Code Insiders** — in `settings.json`:

```jsonc
"mcp.servers": {
  "slop-kanban": {
    "command": "bun",
    "args": ["<absolute-path-to-dist>/server.js"]
  }
}
```

**Goose** — add the same command to your Goose MCP config.

Call the `open_kanban` tool from the host's chat. The iframe renders the kanban and the model starts receiving state updates (debounced markdown projections).

## What to look for

- The iframe visibly renders three columns with two initial cards.
- After the host connects, `app.updateModelContext` fires: the model context now contains `# Kanban — live state from the iframe` followed by a state + actions block.
- Asking the model "what cards are in doing?" answers correctly without any tool call — state arrives via context.
- Toggling/deleting a card in the iframe triggers a patch → debounced re-projection → updated context on the next model turn.
