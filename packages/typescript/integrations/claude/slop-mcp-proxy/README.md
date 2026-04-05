# claude-slop-mcp-proxy

Claude Code plugin for SLOP — generic-action variant. Connect Claude to SLOP-enabled apps while keeping a fixed five-tool MCP surface.

## What it does

SLOP (Semantic Live Observable Protocol) lets apps expose their live state and actions to AI systems. This variant bridges SLOP providers to Claude by:

- **Discovering** local native apps and web apps running in the browser
- **Connecting** via WebSocket, Unix socket, or extension relay
- **Injecting state** into Claude's context on every user message
- **Using generic action tools** instead of registering one MCP tool per affordance
- **Keeping token overhead predictable** with a fixed tool catalog

## How it works

```
Local native apps ──Unix socket / WebSocket──┐
                                              │
Server-backed web apps ──direct WebSocket─────┤
                                              ├── slop-bridge (MCP server) ←→ Claude
Browser SPAs ──postMessage──Extension─────────┤
                     (relay via bridge)       │
                                              │
                 @slop-ai/discovery SDK ──────┘
```

## Setup

After installing the plugin, install the MCP server dependencies:

```bash
cd <plugin-directory>/servers
bun install
```

### Auto-allow permissions

To avoid approving the same five tools repeatedly, add this to your project's `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_claude-slop-mcp-proxy_slop-bridge__*"
    ]
  }
}
```

This allows the plugin's fixed tool set: `discover_apps`, `connect_app`, `disconnect_app`, `app_action`, and `app_action_batch`.

## Tools

This plugin provides **5 static MCP tools**:

| Tool | Purpose |
|------|---------|
| `discover_apps` | Discover SLOP apps and show which ones are already connected |
| `connect_app` | Connect to a specific SLOP app |
| `disconnect_app` | Disconnect from an app |
| `app_action` | Perform a single action on an app node |
| `app_action_batch` | Perform multiple actions in one call |

App state is injected into context on every user message via a `UserPromptSubmit` hook. Claude reads affordances, paths, and parameter schemas from the injected state tree and uses the generic action tools to invoke them.

## Comparison with `slop-native`

| | **slop-mcp-proxy** (this) | **slop-native** |
|---|---|---|
| Tool count | Fixed (5 tools) | Grows with affordances |
| Affordance invocation | Generic `app_action(app, path, action, params)` | Per-affordance tool (e.g. `excalidraw__zoom_to_fit`) |
| Schema validation | Model reads schemas from injected state | MCP validates per-tool JSON Schema |
| Token cost | Low (5 tool definitions) | Higher (N tool definitions) |
| Best fit | Lowest-overhead integration surface | Direct, ergonomic tool calling |

## Usage

Ask Claude to interact with a SLOP-enabled app:

- "What apps are available?" — discovers local + web providers
- "Connect to my kanban board" — connects and injects the current state tree
- "Add three tasks to my todo list" — Claude uses `app_action_batch`
- "Disconnect from the kanban board" — removes the app from injected context

## Building

```bash
cd servers
bun run build
```

## Installation

Add this plugin directory to your Claude Code plugins configuration.
