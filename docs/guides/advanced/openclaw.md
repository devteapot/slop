# OpenClaw Integration

`@slop-ai/openclaw-plugin` lets OpenClaw discover SLOP-enabled apps on your machine and act on them through five tools:

- `list_apps`
- `connect_app`
- `disconnect_app`
- `app_action`
- `app_action_batch`

## What it does

- **Discovers** SLOP apps — local native apps, WebSocket servers, and browser tabs via the extension bridge (powered by `@slop-ai/discovery`)
- **Injects state** into the prompt before each inference via `before_prompt_build` — the model sees live app state without calling any tool
- **Exposes actions** through `app_action` and `app_action_batch` meta-tools
- **Supports multiple apps** connected simultaneously

## Install the plugin

From a local checkout:

```bash
openclaw plugins install --link /path/to/slop/packages/typescript/integrations/openclaw-plugin
```

When your OpenClaw setup supports registry installs:

```bash
openclaw plugins install @slop-ai/openclaw-plugin
```

Verify the plugin:

```bash
openclaw plugins inspect slop
```

## How it works

### State injection (via `before_prompt_build`)

The plugin registers a `before_prompt_build` hook that injects connected providers' state trees as `prependContext`. On every inference turn, the model sees:

```
## SLOP Apps

1 app(s) connected. Use app_action or app_action_batch to act on them. Call connect_app to refresh state or disconnect_app when you're done.

### Kanban Board (kanban-app)
```
[root] kanban-app: Kanban Board
  [collection] columns (count=3)
    [item] col-1: Backlog  actions: {add_card(title: string)}
```

### Available (not connected)
- **Chat App** (id: `chat-app`, ws, local)
```

The model knows what state exists and what actions are available without calling any tool.

### Tools

| Tool | Purpose |
|---|---|
| `list_apps` | List all available apps and show which ones are already connected |
| `connect_app` | Connect to an app and see its full state tree |
| `disconnect_app` | Disconnect from an app and stop injecting its state |
| `app_action` | Perform a single action: `app_action(app, path, action, params)` |
| `app_action_batch` | Perform multiple actions in one call |

### Discovery

The plugin uses `@slop-ai/discovery` for provider discovery, which covers:

- `~/.slop/providers/` — persistent user-level providers
- `/tmp/slop/providers/` — session-level ephemeral providers
- Browser extension bridge — web apps announced over `ws://127.0.0.1:9339/slop-bridge`

All three transport types (Unix socket, WebSocket, postMessage relay) are supported.

## Example interaction

```text
# Model sees kanban state in context via before_prompt_build injection

list_apps()                     # List available apps
connect_app("kanban")           # Connect and get full state + actions
app_action("kanban", "/columns/backlog", "add_card", { title: "Ship docs" })
app_action_batch("kanban", [
  { path: "/columns/backlog", action: "add_card", params: { title: "Task 1" } },
  { path: "/columns/backlog", action: "add_card", params: { title: "Task 2" } },
])
disconnect_app("kanban")       # Stop tracking the app when you're done
```

## Why meta-tools instead of dynamic tools

The Claude Code plugin uses **dynamic tool injection** — when an app connects, its affordances are registered as individual MCP tools (e.g., `kanban__add_card`), and Claude calls them directly. This is possible because MCP supports `notifications/tools/list_changed`, allowing the server to add and remove tools at runtime.

OpenClaw's plugin SDK does not support runtime tool registration. Tools must be:

1. Declared in the plugin manifest (`openclaw.plugin.json` → `contracts.tools`)
2. Registered once during the `register()` callback via `api.registerTool()`

There is no `api.unregisterTool()` or `api.updateTools()` API. This means the plugin cannot add per-app tools when providers connect or remove them when providers disconnect.

The workaround is the **meta-tool pattern**: five stable tools (`list_apps`, `connect_app`, `disconnect_app`, `app_action`, `app_action_batch`) that resolve actions dynamically at runtime. The model knows the exact paths and action names from the state injection, so it gets the call right on the first try.

### What would be needed for dynamic tools in OpenClaw

If OpenClaw adds a runtime tool registration API (e.g., `api.registerDynamicTools()` or `api.updateToolList()`), the plumbing is already in place:

- `createDynamicTools(discovery)` from `@slop-ai/discovery` generates namespaced tool definitions from all connected providers
- Each tool maps to `{ providerId, path, action }` via a `resolve()` function
- The same helper is already used by the Claude Code MCP server

## Comparison with Claude Code

| Feature | Claude Code | OpenClaw |
|---|---|---|
| State injection | `UserPromptSubmit` hook → file-based | `before_prompt_build` → `prependContext` |
| Available apps in context | Yes (discovered + connected) | Yes (discovered + connected) |
| Action tools | Dynamic per-app tools (`kanban__add_card`) | Meta-tools (`app_action`) |
| Batch actions | `app_action_batch` | `app_action_batch` |
| List tool | `list_apps` | `list_apps` |
| Connect tool | `connect_app` | `connect_app` |
| Disconnect tool | `disconnect_app` | `disconnect_app` |
| Discovery | `@slop-ai/discovery` | `@slop-ai/discovery` |
| Bridge support | Yes | Yes |
| Staleness protection | 30s timestamp check | Not needed (in-process) |

The key difference is action dispatch. Claude Code uses MCP's dynamic tool list to expose affordances as first-class tools. OpenClaw uses stable meta-tools because its plugin SDK requires upfront tool declaration.

Both approaches give the model full context about available state and actions. The meta-tool pattern adds one layer of indirection (`app_action` call instead of `kanban__add_card` call) but is otherwise equivalent in capability.

## Related pages

- [OpenClaw package API](../../api/openclaw-plugin.md)
- [Consumer SDK](../../api/consumer.md)
- [Discovery & Bridge](/sdk/discovery) — shared discovery layer
- [Codex integration](/guides/advanced/codex) — fixed-tool Codex plugin using the same meta-tool pattern
- [Claude Code integration](/guides/advanced/claude-code) — comparison integration
