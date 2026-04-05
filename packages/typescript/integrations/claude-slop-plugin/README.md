# claude-slop-plugin

Connect Claude to any SLOP-enabled application — local native apps and web apps alike. Discovers providers, subscribes to live state trees, and exposes app affordances as first-class tools so Claude can see and act on your apps in real time.

## What it does

SLOP (Semantic Live Observable Protocol) is a standard for apps to expose their state and actions to AI systems. This plugin bridges SLOP providers to Claude:

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

The plugin dynamically registers tools for each connected app. To avoid approving every tool call individually, add this to your project's `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_claude-slop-plugin_slop-bridge__*"
    ]
  }
}
```

This allows all tools from the plugin's MCP server — both the lifecycle tools (`connected_apps`, `disconnect_app`) and every dynamic affordance tool from connected apps.

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

- "What apps are available?" — discovers local + web providers
- "Connect to my kanban board" — connects, injects state, registers action tools
- "Add three tasks to my todo list" — Claude calls the app's tools directly
- "Disconnect from the kanban board" — removes tools and state

## Tools

### Lifecycle tools (always available)

| Tool | Purpose |
|------|---------|
| `connected_apps` | List all discovered apps, or connect to a specific app. Connecting triggers state injection and dynamic tool registration. |
| `disconnect_app` | Explicitly disconnect from an app. Removes its tools and stops state updates. |

### Dynamic affordance tools (per-app, after connecting)

When an app connects, its affordances are registered as first-class MCP tools via `tools/list_changed`. For example, connecting to an Excalidraw whiteboard might register:

- `excalidraw__canvas__zoom_to_fit`
- `excalidraw__canvas__toggle_theme`
- `excalidraw__elements__add_rectangle(x, y, width, height, ...)`
- `excalidraw__elements__add_text(x, y, text, font_size)`

Claude calls these directly — no proxy through meta-tools needed. Tools are removed when the app disconnects.

## Components

| Component | Purpose |
|-----------|---------|
| **MCP Server** (`slop-bridge`) | Discovery + connection lifecycle. Registers dynamic affordance tools via `tools/list_changed`. |
| **Skill** (`slop-connect`) | Teaches Claude the SLOP workflow: discover, connect, read state, act |
| **Hook** (`UserPromptSubmit`) | Injects connected providers' state into Claude's context each turn |

## How it works

1. The MCP server uses `createDiscoveryService` from `@slop-ai/discovery` to discover SLOP providers from the local filesystem and the browser extension bridge.
2. When Claude calls `connected_apps` with an app name, the service lazy-connects via the appropriate transport (WebSocket, Unix socket, or extension relay) and subscribes to the state tree.
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

## Requirements

- Bun or Node.js 18+
- One or more SLOP-enabled applications (local or web)
- For web apps: the SLOP browser extension

## Learn more

- [Discovery & Bridge docs](/sdk/discovery) — discovery layer architecture
- [Claude Code integration guide](/guides/advanced/claude-code) — detailed setup and usage
- [`@slop-ai/consumer`](https://www.npmjs.com/package/@slop-ai/consumer) — SLOP consumer SDK
- [`@slop-ai/discovery`](https://www.npmjs.com/package/@slop-ai/discovery) — discovery + bridge + tool mapping
