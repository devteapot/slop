# Codex Integration

SLOP ships a Codex plugin at `packages/typescript/integrations/codex/slop`.

It gives Codex five stable MCP tools for discovering and controlling SLOP-enabled applications:

- `list_apps`
- `connect_app`
- `disconnect_app`
- `app_action`
- `app_action_batch`

## What it does

- **Discovers** SLOP apps from local provider descriptors and the browser extension bridge
- **Connects** to Unix socket, WebSocket, and relay-backed providers through `@slop-ai/discovery`
- **Injects live state** for connected apps on each future user prompt through a Codex hook
- **Returns an immediate snapshot** through `connect_app`, including the current state tree and available actions
- **Acts through stable meta-tools** so Codex has a predictable tool surface
- **Supports multiple apps** connected simultaneously

## Install

Copy or symlink the plugin into your Codex plugins directory:

```bash
# From the repo root
cp -r packages/typescript/integrations/codex/slop ~/.codex/plugins/slop
```

The plugin includes a bundled MCP bridge in `servers/dist/slop-bridge.bundle.mjs`, so the copied plugin can run as-is. To rebuild the bundle from source:

```bash
cd ~/.codex/plugins/slop/servers
bun install
bun run build
```

## How it works

### MCP bridge

The plugin's `.mcp.json` starts a local stdio MCP server:

- command: `node`
- cwd: `./servers`
- entrypoint: `./dist/slop-bridge.bundle.mjs`

That bridge wraps `@slop-ai/discovery` and exposes a fixed five-tool surface to Codex.

### Hook-based state injection

The bridge writes connected-provider state to `/tmp/codex-slop-plugin/state.json` whenever provider state changes. A bundled `UserPromptSubmit` hook reads that file and injects markdown into future Codex turns:

````text
## SLOP Apps

1 app(s) connected. Read the state trees below before acting...

### Kanban (kanban)

```
[collection] board: Sprint Board (...)
  [collection] backlog: Backlog (...)  actions: {add_card(title: string)}
```
````

The hook skips injection if the state file is older than 30 seconds, which prevents stale state from a dead MCP process from lingering in context.

### Skill-guided workflow

The bundled `slop-connect` skill teaches Codex the intended control loop:

1. `list_apps`
2. `connect_app("target-app")`
3. inspect the returned same-turn state tree
4. on later turns, read the injected `## SLOP Apps` context
5. `app_action(...)` or `app_action_batch(...)`
6. `disconnect_app(...)` when done

Codex does not need to call `connect_app` before every action. `connect_app` is for establishing or refreshing a connection; once connected, the hook keeps the current state in context on future user turns.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_apps` | List all discovered SLOP-enabled apps and show which are already connected |
| `connect_app` | Connect to an app, return its current state tree plus action summary, and enroll it in injected context |
| `disconnect_app` | Disconnect from an app |
| `app_action` | Invoke one affordance on a node |
| `app_action_batch` | Invoke multiple affordances in a single call |

## Discovery sources

| Source | Transport | How it's found |
| --- | --- | --- |
| `~/.slop/providers/*.json` | Unix socket or WebSocket | File watcher + periodic scan |
| `/tmp/slop/providers/*.json` | Unix socket or WebSocket | File watcher + periodic scan |
| Browser extension bridge | WebSocket or postMessage relay | Bridge client at `ws://127.0.0.1:9339/slop-bridge` |

## Why the Codex plugin uses meta-tools

The Codex integration currently chooses the same fixed-tool model as the OpenClaw plugin:

- Codex gets a stable, predictable MCP tool catalog
- the hook can inject live state without rebuilding tools on every patch
- the skill can reliably teach the connect-once, inspect, then act workflow

When Codex support for dynamic per-affordance tool flows becomes desirable, the same `@slop-ai/discovery` layer can be extended in that direction.

## Example interaction

```text
User: What apps are available?
→ Codex calls list_apps

User: Connect to the kanban board
→ Codex calls connect_app("kanban")

User: Add three cards to the backlog
→ Codex reads the injected Kanban tree from context, then calls app_action_batch with three add_card actions

User: Disconnect from the kanban board
→ Codex calls disconnect_app("kanban")
```

## Related

- [Discovery & Bridge](/sdk/discovery) — shared discovery layer used by the plugin
- [Consumer guide](/guides/consumer) — direct consumer usage patterns
- [Claude Code integration](/guides/advanced/claude-code) — dynamic-tool and proxy variants for Claude
- [OpenClaw integration](/guides/advanced/openclaw) — comparison integration using the same meta-tool pattern
