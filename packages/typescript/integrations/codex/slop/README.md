# codex-slop

Codex plugin for SLOP. It lets Codex discover SLOP-enabled desktop and web apps on the current machine, inspect their semantic state trees, and invoke affordances through five stable MCP tools:

- `list_apps`
- `connect_app`
- `disconnect_app`
- `app_action`
- `app_action_batch`

## What it does

- Discovers SLOP apps from local provider descriptors and the browser extension bridge
- Connects to Unix socket, WebSocket, and browser-relayed providers through `@slop-ai/discovery`
- Injects connected apps' live state into future user turns through a `UserPromptSubmit` hook
- Gives Codex a fixed MCP surface that works well with Codex skills and tool calling
- Supports multiple connected apps at once for cross-app workflows

## Install

Copy or symlink the plugin into your Codex plugins directory:

```bash
# From the repo root
cp -r packages/typescript/integrations/codex/slop ~/.codex/plugins/slop
```

The plugin ships with a bundled MCP bridge at `servers/dist/slop-bridge.bundle.mjs`, so the copied plugin can run without workspace installs. If you want to rebuild that bundle from source:

```bash
cd ~/.codex/plugins/slop/servers
bun install
bun run build
```

## How it works

Codex loads the plugin-local MCP server from `.mcp.json`. That server uses `@slop-ai/discovery` to:

1. discover local and browser-announced SLOP providers
2. connect to a provider on demand with `connect_app`
3. write connected-provider state to `/tmp/codex-slop-plugin/state.json`
4. let the bundled `UserPromptSubmit` hook inject that state into future Codex turns
5. execute actions through `app_action` or `app_action_batch`

`connect_app` still returns the current formatted state tree immediately, so Codex can inspect and act in the same turn it establishes a connection. After that, future user turns get live injected state automatically.

## Workflow

1. Call `list_apps` to see what's available.
2. Call `connect_app("app-name")` once to connect and get the first state snapshot.
3. Use `app_action` or `app_action_batch` with the exact path and action names from that snapshot.
4. On later user turns, read the injected `## SLOP Apps` context instead of reconnecting every time.
5. Leave the app connected while you work, or call `disconnect_app` when you're done.

## Components

| Component | Purpose |
| --- | --- |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.mcp.json` | Plugin-local MCP server wiring |
| `hooks/hooks.json` | `UserPromptSubmit` hook wiring for state injection |
| `skills/slop-connect` | Codex-native workflow guidance for app discovery and control |
| `servers/slop-bridge.mjs` | Fixed-tool MCP bridge backed by `@slop-ai/discovery` |

## Documentation

- Codex guide: https://docs.slopai.dev/guides/advanced/codex
- Discovery layer: https://docs.slopai.dev/sdk/discovery
- Consumer SDK: https://docs.slopai.dev/api/consumer
