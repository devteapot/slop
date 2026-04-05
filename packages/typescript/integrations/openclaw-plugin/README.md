# `@slop-ai/openclaw-plugin`

OpenClaw plugin for discovering and controlling SLOP-enabled apps.

The plugin watches local SLOP providers, subscribes to their trees, and exposes two OpenClaw tools:

- `connected_apps` to inspect connected providers and their available actions
- `app_action` to invoke an affordance on a provider

## Install

```bash
openclaw plugins install --link /path/to/slop/packages/typescript/openclaw-plugin
```

If your OpenClaw setup supports registry installation, use the package name:

```bash
openclaw plugins install @slop-ai/openclaw-plugin
```

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

The plugin connects to Unix socket and WebSocket providers automatically.

## Example

```text
connected_apps("kanban")
app_action("kanban", "/", "add_card", { column: "backlog", title: "Ship docs" })
```

## Documentation

- API reference: https://docs.slopai.dev/api/openclaw-plugin
- OpenClaw guide: https://docs.slopai.dev/guides-advanced/openclaw
- Consumer SDK: https://docs.slopai.dev/api/consumer
