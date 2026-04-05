# claude-slop-native

Claude Code plugin for SLOP — direct-tool variant. Connect Claude to local native apps and web apps alike, subscribe to their live state trees, and expose app affordances as first-class tools so Claude can see and act on your apps in real time.

## What it does

SLOP (Semantic Live Observable Protocol) is a standard for apps to expose their state and actions to AI systems. This plugin bridges SLOP providers to Claude by:

- **Discovers** SLOP-enabled apps — both local native apps and web apps running in the browser
- **Connects** via WebSocket, Unix socket, or extension relay (for browser-only SPAs)
- **Injects state** directly into Claude's context on every message — no manual fetching
- **Registers affordances as tools** — each app action becomes a first-class tool (e.g. `kanban__add_card`, `excalidraw__elements__add_rectangle`). Claude calls them directly.
- **Supports multiple apps** connected simultaneously for cross-app workflows

## Setup

After installing the plugin, install the MCP server dependencies:

```bash
cd <plugin-directory>/servers
bun install
```

### Auto-allow permissions

This variant dynamically registers tools for each connected app. To avoid approving every tool call individually, add this to your project's `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_claude-slop-native_slop-bridge__*"
    ]
  }
}
```

This allows all tools from the plugin's MCP server — both the lifecycle tools (`list_apps`, `connect_app`, `disconnect_app`) and every dynamic affordance tool from connected apps.

## Comparison with `slop-mcp-proxy`

| | **slop-native** (this) | **slop-mcp-proxy** |
|---|---|---|
| Tool count | Grows with connected affordances | Fixed (5 tools) |
| Affordance invocation | Per-affordance tool (e.g. `excalidraw__zoom_to_fit`) | Generic `app_action(app, path, action, params)` |
| Schema validation | MCP validates per-tool JSON Schema | Model reads schemas from injected state |
| Token cost | Higher (N tool definitions) | Lower (5 tool definitions) |
| Best fit | Direct, ergonomic tool calling | Lowest-overhead integration surface |

### Local apps

The plugin auto-discovers SLOP providers from:
- `~/.slop/providers/` (user-level)
- `/tmp/slop/providers/` (session-level)

### Web apps (via browser extension)

To discover and interact with SLOP-enabled web apps, install the SLOP browser extension. The plugin automatically connects to the extension's local bridge at `ws://127.0.0.1:9339/slop-bridge` and receives provider announcements as you browse.

Two types of web providers are supported:
- **WebSocket providers** — server-backed web apps. The plugin connects directly to the app's WebSocket endpoint.
- **postMessage providers** — client-only SPAs. The plugin communicates through the extension relay.

Both types appear seamlessly in discovery results and work identically once connected.

## Usage

Ask Claude to interact with a SLOP-enabled app:

- "What apps are available?" — lists local + web providers
- "Connect to my kanban board" — connects, injects state, registers action tools
- "Add three tasks to my todo list" — Claude calls the app's tools directly
- "Disconnect from the kanban board" — removes tools and state

## Tools

### Lifecycle tools (always available)

| Tool | Purpose |
|------|---------|
| `list_apps` | List all available apps and show which ones are already connected. |
| `connect_app` | Connect to a specific app. Connecting triggers state injection and dynamic tool registration. |
| `disconnect_app` | Explicitly disconnect from an app. Removes its tools and stops state updates. |

### Dynamic affordance tools (per-app, after connecting)

When an app connects, its affordances are registered as first-class MCP tools via `tools/list_changed`.

Affordances that share the same `action` name and identical `params` schema are **grouped** into a single tool with a `target` parameter, rather than registering one tool per node. For example, if an Excalidraw whiteboard has 200 elements each with `delete` and `set_property` actions, this produces 2 grouped tools instead of 400 individual ones:

- `excalidraw__delete(target="/elements/rect-1")` — 200 targets
- `excalidraw__set_property(target="/elements/rect-1", key, value)` — 200 targets
- `excalidraw__canvas__zoom_to_fit` — singleton (only on canvas node)
- `excalidraw__canvas__toggle_theme` — singleton

Singleton affordances (unique action on a single node) keep the `{nodeId}__{action}` naming with a fixed path. Grouped tools use just the `{action}` name and require the caller to specify which node via `target`. The LLM picks the correct target path from the state tree (injected on every turn via the hook).

If two groups of nodes share the same action name but have different param schemas (e.g. `edit` on cards takes `title` while `edit` on comments takes `body`), they remain separate tools with disambiguated names.

Claude calls these directly — no proxy through meta-tools needed. Tools are removed when the app disconnects.

## Components

| Component | Purpose |
|-----------|---------|
| **MCP Server** (`slop-bridge`) | Discovery + connection lifecycle. Registers dynamic affordance tools via `tools/list_changed`. |
| **Skill** (`slop-connect`) | Teaches Claude the SLOP workflow: list, connect, read state, act |
| **Hook** (`UserPromptSubmit`) | Injects connected providers' state into Claude's context each turn |

## How it works

1. The MCP server uses `createDiscoveryService` from `@slop-ai/discovery` to discover SLOP providers from the local filesystem and the browser extension bridge.
2. When Claude calls `connect_app` with an app name, the service lazy-connects via the appropriate transport (WebSocket, Unix socket, or extension relay) and subscribes to the state tree.
3. `createDynamicTools` from `@slop-ai/discovery` converts each connected app's affordances into namespaced MCP tools. The server notifies Claude via `tools/list_changed`.
4. Claude calls affordance tools directly (e.g. `excalidraw__elements__add_rectangle`). The server resolves each tool name to a provider + path + action and invokes it.
5. The `UserPromptSubmit` hook reads a shared state file (`/tmp/claude-slop-plugin/state.json`) that the MCP server updates whenever state changes, injecting live state into Claude's context.
6. When Claude calls `disconnect_app`, the provider is disconnected, its tools are removed, and state drops from the hook.

## Architecture

```
Local native apps ──Unix socket / WebSocket──┐
                                              │
Server-backed web apps ──direct WebSocket─────┤
                                              ├── slop-bridge (MCP server) ←→ Claude
Browser SPAs ──postMessage──Extension─────────┤
                     (relay via bridge)       │
                                              │
                 @slop-ai/discovery SDK ──────┘
                   ├── createDiscoveryService (discovery + connections)
                   ├── createDynamicTools (affordance → tool mapping)
                   ├── createToolHandlers (lifecycle tool logic)
                   └── createBridgeClient/Server (extension relay)
```

## Known limitations

### Tool context cost while idle

All dynamic affordance tools remain registered for the lifetime of the connection. Apps with many distinct action+schema combinations can consume significant context tokens (~128 tokens per tool) even when Claude isn't actively interacting with the app.

**Planned improvement: idle tool deregistration.** Track the last tool call per provider. After a configurable idle timeout (e.g. 60 seconds with no tool calls), deregister that provider's tools via `tools/list_changed` to free context. The connection and state subscription stay alive — the hook still injects the state tree each turn so Claude retains awareness of the app. When Claude needs to act again, a single `connect_app("appname")` call re-registers the tools instantly from the cached state (no reconnection needed).

This gives the best of both worlds: direct tool calls with zero overhead during active use, freed context when idle.

## Requirements

- Bun or Node.js 18+
- One or more SLOP-enabled applications (local or web)
- For web apps: the SLOP browser extension

## Learn more

- [Discovery & Bridge docs](/sdk/discovery) — discovery layer architecture
- [Claude Code integration guide](/guides/advanced/claude-code) — detailed setup and usage
- [`@slop-ai/consumer`](https://www.npmjs.com/package/@slop-ai/consumer) — SLOP consumer SDK
- [`@slop-ai/discovery`](https://www.npmjs.com/package/@slop-ai/discovery) — discovery + bridge + tool mapping
