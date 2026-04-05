# `@slop-ai/openclaw-plugin`

OpenClaw plugin for discovering and controlling SLOP-enabled apps.

The plugin watches SLOP providers, subscribes to their trees, injects live state into the prompt, and exposes five OpenClaw tools:

- `list_apps` to list available providers
- `connect_app` to inspect a provider's current state and actions
- `disconnect_app` to stop tracking an app
- `app_action` to invoke a single affordance on a provider
- `app_action_batch` to invoke multiple affordances in one call

## Install

```bash
openclaw plugins install --link /path/to/slop/packages/typescript/integrations/openclaw-plugin
```

If your OpenClaw setup supports registry installation, use the package name:

```bash
openclaw plugins install @slop-ai/openclaw-plugin
```

## How it works

The plugin uses `@slop-ai/discovery` for provider discovery and connection management, and injects provider state into the prompt via OpenClaw's `before_prompt_build` hook. The model sees live app state before every inference turn, then uses `app_action` or `app_action_batch` with the exact paths and action names shown in context.

## How provider discovery works

Providers register themselves in `~/.slop/providers/` with a descriptor like:

```json
{
  "id": "my-app",
  "name": "My App",
  "slop_version": "0.1",
  "transport": {
    "type": "unix",
    "path": "/tmp/slop/my-app.sock"
  },
  "capabilities": ["state", "patches", "affordances"]
}
```

The plugin discovers providers from:

- `~/.slop/providers/` for persistent local providers
- `/tmp/slop/providers/` for session-scoped providers
- the browser extension bridge for web apps

The plugin connects to Unix socket, WebSocket, and browser-relayed providers automatically.

## Example

```text
list_apps()
connect_app("kanban")
app_action("kanban", "/columns/backlog", "add_card", { title: "Ship docs" })
app_action_batch("kanban", [
  { path: "/columns/backlog", action: "add_card", params: { title: "Task 1" } },
  { path: "/columns/backlog", action: "add_card", params: { title: "Task 2" } }
])
disconnect_app("kanban")
```

## Documentation

- API reference: https://docs.slopai.dev/api/openclaw-plugin
- OpenClaw guide: https://docs.slopai.dev/guides/advanced/openclaw
- Consumer SDK: https://docs.slopai.dev/api/consumer
