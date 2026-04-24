# mcp-apps-bridge demo

End-to-end example of a SLOP provider rendered inside an MCP Apps host (Claude / VS Code Insiders / Goose).

A single Node process runs three things:

1. **A SLOP provider** over WebSocket on `:7411/slop` (kanban state in `@slop-ai/server`).
2. **An MCP server** over stdio that:
   - Exposes `open_kanban`, an MCP Apps tool returning the iframe.
   - Mirrors every SLOP affordance as a callable MCP tool via `registerSlopTools`, so the model can act on the board from chat (not just observe it).
3. **The iframe bundle** (`dist/iframe.html`) — a thin SLOP consumer wired to `@slop-ai/mcp-apps-bridge`. Subscribes to the same WS provider and pushes salience-filtered markdown projections into `app.updateModelContext`.

## Build & run

```bash
bun install
bun run build
realpath dist/server.js  # absolute path for host configs below
```

Override the WS port with `SLOP_PORT=…` if `7411` is taken; the iframe URL inside `src/app.ts` must match.

## Connect a host

**MCP Inspector** — fastest smoke test:

```bash
bunx @modelcontextprotocol/inspector bun dist/server.js
```

**VS Code Insiders** — `MCP: Open User Configuration` (Cmd+Shift+P) and add:

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

Reload window, then in chat: `Use the open_kanban tool to show me the board.`

**Goose** — `~/.config/goose/config.yaml`:

```yaml
extensions:
  slop-kanban:
    type: stdio
    cmd: bun
    args: ["<absolute-path-to>/dist/server.js"]
    enabled: true
```

## What to look for

- The iframe renders three columns with two initial cards.
- The model receives `# Kanban — live state from the iframe` in context the next turn — ask "what cards are in doing?" and it answers without making another tool call.
- The model can act: ask "add a card called 'Ship it' to todo" — it calls `add_card` with `{ target: "/todo", title: "Ship it" }`, the SLOP provider updates, the iframe re-renders, and the next turn's context reflects the new card.
- `tools/list_changed` notifications fire as state evolves; the model's available tool list stays in sync with affordances on the live tree.

## Architecture

```
┌─ host process (VS Code / Goose / etc.) ─────────────────────┐
│                                                              │
│   MCP client ──stdio─▶ MCP server (this demo)                │
│        │                  │                                   │
│        │                  ├── @slop-ai/server  ◀──ws──┐       │
│        │                  │   (kanban state)          │       │
│        │                  └── registerSlopTools  ◀────┘       │
│        │                      (one MCP tool per affordance)   │
│        ▼                                                      │
│   sandboxed iframe (open_kanban)                              │
│        │                                                      │
│        └── @slop-ai/mcp-apps-bridge ──ws──▶ same SLOP server  │
│              ├── consumer mirrors tree                         │
│              ├── projector → app.updateModelContext           │
│              └── UI renders from consumer.getTree()           │
└──────────────────────────────────────────────────────────────┘
```
