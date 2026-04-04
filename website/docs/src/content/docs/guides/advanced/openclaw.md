---
title: "OpenClaw Integration"
description: "Control SLOP-enabled applications through OpenClaw"
---
`@slop-ai/openclaw-plugin` lets OpenClaw discover SLOP-enabled apps on your machine and act on them through two tools:

- `connected_apps`
- `app_action`

## What it does

Any SLOP provider registered on the machine becomes available to OpenClaw without writing one tool per affordance. The plugin mirrors provider state and resolves actions dynamically at runtime.

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

## How discovery works

The plugin watches `~/.slop/providers/` for descriptors such as:

```json
{
  "id": "my-app",
  "name": "My App",
  "slop_version": "0.1",
  "transport": { "type": "unix", "path": "/tmp/slop/my-app.sock" },
  "capabilities": ["state", "patches", "affordances"]
}
```

Supported transports:

- Unix socket providers
- WebSocket providers

## Example interaction

```text
connected_apps("kanban")
app_action("kanban", "/", "add_card", { column: "backlog", title: "Ship docs" })
```

## Why the plugin uses two tools

SLOP providers are dynamic. Their actions change with live state, and new providers can appear or disappear while OpenClaw is running. Using two stable meta-tools avoids a giant, ever-changing tool registry while still giving the model access to the full provider tree.

## Related pages

- [OpenClaw package API](/api/openclaw-plugin)
- [Consumer SDK](/api/consumer)
