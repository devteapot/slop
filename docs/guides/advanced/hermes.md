# Hermes Integration

SLOP ships a Hermes plugin at `packages/python/slop-hermes`.

It gives Hermes five stable tools for discovering and controlling SLOP-enabled applications:

- `list_apps`
- `connect_app`
- `disconnect_app`
- `app_action`
- `app_action_batch`

## What it does

- **Discovers** SLOP apps from local provider descriptors and the browser extension bridge through `slop_ai.discovery`
- **Injects live state** into each Hermes turn through the plugin `pre_llm_call` hook
- **Returns an immediate snapshot** through `connect_app`, including the current state tree and action summary
- **Acts through stable meta-tools** so Hermes always sees the same tool catalog
- **Supports multiple apps** connected simultaneously

## Install

Install `slop-hermes` into the same Python environment as Hermes:

```bash
pip install slop-hermes
```

From a local checkout:

```bash
pip install -e /path/to/slop/packages/python/slop-hermes
```

Verify that Hermes sees the plugin:

```bash
hermes plugins list
```

You should see a `slop` plugin entry.

If you explicitly manage toolsets, make sure the plugin toolset is enabled:

```bash
hermes tools
```

Or include it directly when starting chat:

```bash
hermes chat --toolsets slop,web,terminal
```

## How it works

### Plugin loading

`slop-hermes` is a pip-installed Hermes plugin. It registers itself through the `hermes_agent.plugins` entry point and exposes a `slop` toolset.

### In-process discovery runtime

The plugin starts a background asyncio runtime on first use. That runtime owns a `slop_ai.discovery.DiscoveryService`, which handles:

- `~/.slop/providers/*.json` descriptor discovery
- `/tmp/slop/providers/*.json` descriptor discovery
- browser extension bridge discovery at `ws://127.0.0.1:9339/slop-bridge`
- connection management for Unix socket, WebSocket, and relay-backed providers

### Hook-based state injection

On every Hermes turn, the plugin's `pre_llm_call` hook injects a compact summary of connected and available apps into the current user message:

````text
## SLOP Apps

1 app(s) connected. Read the state trees below before acting...

### Kanban (kanban)

```
[root] kanban: Kanban Board  actions: {add_card(title: string)}
  [collection] backlog  "12 cards"
```

### Available (not connected)

- **Calendar** (id: `calendar`, ws, bridge)
````

Hermes can answer from injected state directly, or use the five SLOP tools when it needs to connect, refresh, or act.

### State compaction

The injected tree is compacted before formatting so prompt usage stays bounded.

Available knobs:

- `SLOP_HERMES_MAX_NODES` — max nodes included in injected trees. Default: `160`
- `SLOP_HERMES_MIN_SALIENCE` — optional salience threshold before rendering

## Tools

| Tool | Purpose |
| --- | --- |
| `list_apps` | List all discovered SLOP-enabled apps and show which are already connected |
| `connect_app` | Connect to an app, return its current state tree plus action summary, and enroll it in injected context |
| `disconnect_app` | Disconnect from an app |
| `app_action` | Invoke one affordance on a node |
| `app_action_batch` | Invoke multiple affordances in a single call |

## Why the Hermes plugin uses meta-tools

The Hermes plugin currently uses the same fixed-tool model as the Codex and OpenClaw integrations:

- Hermes plugin tools are registered once during plugin initialization
- prompt injection gives Hermes live app state before every turn
- actions still go through `app_action` and `app_action_batch`

This keeps the integration simple and predictable while matching Hermes' plugin model.

## Operational scope

This first version is designed primarily for **local CLI / single-user Hermes**.

The discovery runtime is process-global, which is a good fit for a single local Hermes instance controlling apps on the same machine. If you need stricter multi-user isolation or remote-host integration, the MCP route is still the safer boundary.

## Example interaction

```text
User: What apps are available?
→ Hermes calls list_apps

User: Connect to the kanban board
→ Hermes calls connect_app("kanban")

User: Add three cards to backlog
→ Hermes reads the injected Kanban tree from context, then calls app_action_batch with three add_card actions

User: Disconnect from kanban
→ Hermes calls disconnect_app("kanban")
```

## Related

- [slop-hermes package API](/api/slop-hermes)
- [Discovery & Bridge](/sdk/discovery) — shared discovery model used by the plugin
- [Python SDK API](/api/python) — underlying `slop_ai.discovery` implementation
- [Codex integration](/guides/advanced/codex) — another fixed-tool integration
- [OpenClaw integration](/guides/advanced/openclaw) — similar meta-tool pattern
