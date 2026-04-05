# Claude Code Integration

SLOP ships two Claude Code integrations:

- `claude-slop-native` — direct-tool variant. Connected app affordances become first-class MCP tools, so Claude calls app-specific tools directly.
- `claude-slop-mcp-proxy` — generic-action variant. Claude reads the injected state tree and uses five stable tools: `discover_apps`, `connect_app`, `disconnect_app`, `app_action`, and `app_action_batch`.

Use `claude-slop-native` by default for the best Claude Code UX. Use `claude-slop-mcp-proxy` when you want a fixed, low-overhead tool catalog.

## What it does

- **Discovers** SLOP apps — local native apps, WebSocket servers, and browser tabs via the extension bridge
- **Injects state** directly into Claude's context on every message — no tool calls for reads
- **Supports both tool models** — dynamic per-affordance tools in `claude-slop-native`, or generic action tools in `claude-slop-mcp-proxy`
- **Supports multiple apps** connected simultaneously for cross-app workflows

## Choose a variant

| Variant | Tool model | Best for |
|---|---|---|
| `claude-slop-native` | Dynamic per-affordance tools | Most ergonomic Claude Code workflow |
| `claude-slop-mcp-proxy` | Fixed generic action tools | Lowest token overhead and stable tool count |

## Install

Copy or symlink the plugin directory you want into your Claude Code plugins:

```bash
# From the repo root
cp -r packages/typescript/integrations/claude/slop-native ~/.claude/plugins/claude-slop-native
```

Then install the MCP server dependencies:

```bash
cd ~/.claude/plugins/claude-slop-native/servers
bun install
bun run build
```

For the generic-action variant, substitute `slop-mcp-proxy` and `claude-slop-mcp-proxy` in the paths above.

## How it works

### State injection (no MCP needed)

Both plugins use a `UserPromptSubmit` hook. It reads a shared state file written by the MCP server and outputs markdown that gets injected into Claude's context:

```
## SLOP Apps

2 app(s) connected. Use the app-specific tools registered for each connected app to act on them directly.

### Kanban Board (kanban-app)
```
[root] kanban-app: Kanban Board
  [collection] columns (count=3)
    [item] col-1: Backlog  actions: {add_card(title: string)}
    ...
```

### Available (not connected)
- **Chat App** (id: `chat-app`, ws, local)
```

Claude sees this on every turn without calling any tool. The state updates live — the MCP server writes the file on every state change (connection, disconnection, patch).

### `claude-slop-native`: dynamic tool injection

When a provider connects, the MCP server converts its affordances into per-app tools and notifies Claude Code via MCP's `notifications/tools/list_changed`. Claude sees tools like:

| Dynamic tool name | Maps to |
|---|---|
| `kanban__backlog__add_card` | `invoke("/columns/backlog", "add_card", ...)` |
| `kanban__col_1__move_card` | `invoke("/columns/col-1", "move_card", ...)` |
| `chat__messages__send` | `invoke("/messages", "send", ...)` |

Each dynamic tool has proper parameter schemas from the provider's affordance definitions. Tool names are prefixed with the app's ID to avoid cross-app collisions.

Dynamic tools are rebuilt on every state change. When affordances appear or disappear (e.g., a node gains a new action, or a provider disconnects), the tool list updates automatically.

Three lifecycle tools remain static and always available:

| Tool | When to use |
|---|---|
| `discover_apps` | List all discovered apps and show which ones are already connected |
| `connect_app` | Connect to an app and trigger dynamic tool registration |
| `disconnect_app` | Remove an app and its dynamic tools when you're done |

### `claude-slop-mcp-proxy`: fixed generic tools

This variant keeps a stable five-tool surface:

| Tool | When to use |
|---|---|
| `discover_apps` | List all discovered apps and show which ones are already connected |
| `connect_app` | Connect to an app and inject its current state |
| `disconnect_app` | Remove an app from injected context |
| `app_action` | Invoke one affordance by `app`, `path`, `action`, and `params` |
| `app_action_batch` | Invoke multiple affordances in one call |

Claude reads the current state tree from context, then constructs `app_action` or `app_action_batch` calls using the exact paths and affordance signatures shown there.

### Discovery sources

| Source | Transport | How it's found |
|---|---|---|
| `~/.slop/providers/*.json` | Unix socket or WebSocket | File watcher + periodic scan |
| `/tmp/slop/providers/*.json` | Unix socket or WebSocket | File watcher + periodic scan |
| Browser extension bridge | WebSocket or postMessage relay | Bridge client at `ws://127.0.0.1:9339/slop-bridge` |

## Example interactions

```
User: What apps are available?
→ Claude can answer from injected state, or call discover_apps when it needs a fresh discovery snapshot

User: Connect to the kanban board
→ Claude calls connect_app("kanban")

User: Add a card to the backlog (native)
→ Claude calls kanban__backlog__add_card({title: "..."}) directly

User: Add three cards to the backlog (mcp-proxy)
→ Claude calls app_action_batch with three add_card actions

User: Disconnect from the kanban board
→ Claude calls disconnect_app("kanban")

User: What changed?
→ Claude reads the updated state from context injection (no tool call)
```

## Architecture

```
Local native apps ──Unix socket / WebSocket──┐
                                              │
Server-backed web apps ──direct WebSocket─────┤
                                              ├── slop-bridge (MCP server)
Browser SPAs ──postMessage──Extension─────────┤     │
                     (relay via bridge)       │     ├── state.json ──→ hook ──→ Claude context
                                              │     │
                 @slop-ai/discovery ──────────┘     ├── native: dynamic tools via tools/list_changed
                                                    └── mcp-proxy: fixed tools (app_action, app_action_batch)
```

## Staleness protection

The state file includes a `lastUpdated` timestamp. The hook skips injection if the file is older than 30 seconds. This prevents stale state from a crashed MCP server from being injected indefinitely.

## Comparison with OpenClaw

`claude-slop-native` uses **dynamic tool injection** because MCP supports `notifications/tools/list_changed` — the server can add and remove tools at runtime. This means Claude calls app-specific tools directly (e.g., `kanban__add_card`) rather than going through a generic `app_action` proxy.

`claude-slop-mcp-proxy` uses the same meta-tool pattern as OpenClaw, but inside Claude Code.

OpenClaw's plugin SDK does not support runtime tool registration — tools must be declared in the plugin manifest and registered once during plugin initialization. The OpenClaw plugin uses meta-tools (`app_action`, `app_action_batch`) instead, with state injection via `before_prompt_build` to give the model full context. See [OpenClaw integration](/guides/advanced/openclaw) for details.

All three integrations share the same underlying `@slop-ai/discovery` package. `claude-slop-native` additionally uses `createDynamicTools()` to expose first-class tools.

## Related

- [Discovery & Bridge](/sdk/discovery) — the discovery layer this plugin builds on
- [Consumer guide](/guides/consumer) — other SLOP consumers (CLI, Desktop, Extension)
- [OpenClaw integration](/guides/advanced/openclaw) — similar integration for OpenClaw
