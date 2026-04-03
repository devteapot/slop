---
title: "@slop-ai/openclaw-plugin"
description: "OpenClaw plugin for discovering and controlling SLOP-enabled applications"
---
The OpenClaw plugin discovers local SLOP providers, mirrors their state, and exposes two OpenClaw tools:

- `connected_apps`
- `app_action`

## Install

```bash
openclaw plugins install --link /path/to/slop/packages/typescript/openclaw-plugin
```

Or, when your OpenClaw environment supports registry installs:

```bash
openclaw plugins install @slop-ai/openclaw-plugin
```

## How discovery works

The plugin watches `~/.slop/providers/` for provider descriptors and connects to supported transports automatically:

- Unix socket providers
- WebSocket providers

## Related pages

- [OpenClaw integration guide](/guides/advanced/openclaw)
- [Consumer SDK](/api/consumer)
