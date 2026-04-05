# @slop-ai/openclaw-plugin

The OpenClaw plugin discovers SLOP providers, injects their state into the prompt, and exposes five tools for interaction:

- `discover_apps` — list discoverable apps
- `connect_app` — connect and inspect an app
- `disconnect_app` — stop tracking an app
- `app_action` — perform a single action
- `app_action_batch` — perform multiple actions in one call

## Install

```bash
openclaw plugins install --link /path/to/slop/packages/typescript/integrations/openclaw-plugin
```

Or, when your OpenClaw environment supports registry installs:

```bash
openclaw plugins install @slop-ai/openclaw-plugin
```

## How it works

The plugin uses `@slop-ai/discovery` for provider discovery (local dirs, bridge, relay) and for shared tool handlers (`createToolHandlers`, etc.).

### State injection

A `before_prompt_build` hook injects connected providers' state trees as `prependContext` on every inference turn. The model sees live app state and available actions without calling any tool, and it can act using `app_action`, `app_action_batch`, or `disconnect_app`.

### Discovery

Watches `~/.slop/providers/` and `/tmp/slop/providers/` for provider descriptors and connects to supported transports:

- Unix socket providers
- WebSocket providers
- Browser extension relay (postMessage providers via bridge)

### Limitations

OpenClaw's plugin SDK does not support runtime tool registration. Tools must be declared in the plugin manifest and registered once during `register()`. This means the plugin cannot dynamically inject per-app action tools (like the Claude Code plugin does via MCP's `notifications/tools/list_changed`). Instead, it uses stable meta-tools (`app_action`, `app_action_batch`) that resolve actions at runtime. See [OpenClaw integration guide](/guides/advanced/openclaw#why-meta-tools-instead-of-dynamic-tools) for details.

## Related pages

- [OpenClaw integration guide](../guides/advanced/openclaw.md)
- [Consumer SDK](./consumer.md)
- [Discovery & Bridge](/sdk/discovery) — shared discovery layer
