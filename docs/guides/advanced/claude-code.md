# Claude Code Integration

`claude-slop-plugin` is a Claude Code plugin that lets Claude discover, observe, and control SLOP-enabled applications in real time.

## What it does

- **Discovers** SLOP apps — local native apps, WebSocket servers, and browser tabs via the extension bridge
- **Injects state** directly into Claude's context on every message — no tool calls for reads
- **Dynamically registers tools** from connected apps' affordances — Claude calls `kanban__add_card({title: "..."})` directly, not a generic proxy
- **Supports multiple apps** connected simultaneously for cross-app workflows

## Install

Copy or symlink the plugin directory into your Claude Code plugins:

```bash
# From the repo root
cp -r packages/typescript/integrations/claude-slop-plugin ~/.claude/plugins/claude-slop-plugin
```

Then install the MCP server dependencies:

```bash
cd ~/.claude/plugins/claude-slop-plugin/servers
bun install
bun run build
```

## How it works

### State injection (no MCP needed)

The plugin's `UserPromptSubmit` hook runs on every user message. It reads a shared state file written by the MCP server and outputs markdown that gets injected into Claude's context:

```
## SLOP Apps

2 app(s) connected. Use app_action to act on apps.

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

### Dynamic tool injection

When a provider connects, the MCP server converts its affordances into per-app tools and notifies Claude Code via MCP's `notifications/tools/list_changed`. Claude sees tools like:

| Dynamic tool name | Maps to |
|---|---|
| `kanban__backlog__add_card` | `invoke("/columns/backlog", "add_card", ...)` |
| `kanban__col_1__move_card` | `invoke("/columns/col-1", "move_card", ...)` |
| `chat__messages__send` | `invoke("/messages", "send", ...)` |

Each dynamic tool has proper parameter schemas from the provider's affordance definitions. Tool names are prefixed with the app's ID to avoid cross-app collisions.

Dynamic tools are rebuilt on every state change. When affordances appear or disappear (e.g., a node gains a new action, or a provider disconnects), the tool list updates automatically.

### Static tools

Two tools remain static and always available:

| Tool | When to use |
|---|---|
| `connected_apps` | Connect to an app (triggers dynamic tool registration) or list all discovered apps |
| `app_action_batch` | Perform multiple actions in one call — faster than calling individual dynamic tools repeatedly |

### Discovery sources

| Source | Transport | How it's found |
|---|---|---|
| `~/.slop/providers/*.json` | Unix socket or WebSocket | File watcher + periodic scan |
| `/tmp/slop/providers/*.json` | Unix socket or WebSocket | File watcher + periodic scan |
| Browser extension bridge | WebSocket or postMessage relay | Bridge client at `ws://127.0.0.1:9339/slop-bridge` |

## Example interactions

```
User: What apps are available?
→ Claude sees the injected state and responds directly, no tool call needed

User: Connect to the kanban board
→ Claude calls connected_apps("kanban") — dynamic tools like kanban__add_card appear

User: Add a card to the backlog
→ Claude calls kanban__backlog__add_card({title: "..."}) directly

User: Add three cards to the backlog
→ Claude calls app_action_batch for efficiency

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
                 @slop-ai/discovery ──────────┘     ├── dynamic tools (kanban__add_card, ...)
                                                    │     registered via tools/list_changed
                                                    └── static tools (connected_apps, app_action_batch)
```

## Staleness protection

The state file includes a `lastUpdated` timestamp. The hook skips injection if the file is older than 30 seconds. This prevents stale state from a crashed MCP server from being injected indefinitely.

## Comparison with OpenClaw

The Claude Code plugin uses **dynamic tool injection** because MCP supports `notifications/tools/list_changed` — the server can add and remove tools at runtime. This means Claude calls app-specific tools directly (e.g., `kanban__add_card`) rather than going through a generic `app_action` proxy.

OpenClaw's plugin SDK does not support runtime tool registration — tools must be declared in the plugin manifest and registered once during plugin initialization. The OpenClaw plugin uses meta-tools (`app_action`, `app_action_batch`) instead, with state injection via `before_prompt_build` to give the model full context. See [OpenClaw integration](/guides/advanced/openclaw) for details.

Both plugins share the same underlying `@slop-ai/discovery` package and `createDynamicTools()` helper. If OpenClaw adds runtime tool registration in the future, the plumbing is already in place.

## Related

- [Discovery & Bridge](/sdk/discovery) — the discovery layer this plugin builds on
- [Consumer guide](/guides/consumer) — other SLOP consumers (CLI, Desktop, Extension)
- [OpenClaw integration](/guides/advanced/openclaw) — similar integration for OpenClaw
