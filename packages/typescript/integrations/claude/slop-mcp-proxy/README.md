# claude-slop-native

Claude Code plugin for SLOP — **native variant** using generic action tools.

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

This plugin provides **4 static MCP tools**:

| Tool | Purpose |
|------|---------|
| `connected_apps` | Discover and connect to SLOP apps |
| `disconnect_app` | Disconnect from an app |
| `app_action` | Perform a single action on an app node |
| `app_action_batch` | Perform multiple actions in one call |

App state is **injected into context** on every user message via a `UserPromptSubmit` hook.
The model reads affordances (paths, actions, parameter schemas) from the injected state tree
and uses the generic `app_action` tool to invoke them.

## Comparison with `slop-mcp-proxy`

| | **slop-native** (this) | **slop-mcp-proxy** |
|---|---|---|
| Tool count | Fixed (4 tools) | Grows with affordances |
| Affordance invocation | Generic `app_action(app, path, action, params)` | Per-affordance tool (e.g. `excalidraw__zoom_to_fit`) |
| Schema validation | Model reads schemas from context | MCP validates per-tool JSON Schema |
| Token cost | Low (4 tool definitions) | Higher (N tool definitions) |
| State injection | Hook (identical) | Hook (identical) |

## Building

```bash
cd servers
bun run build
```

## Installation

Add this plugin directory to your Claude Code plugins configuration.
