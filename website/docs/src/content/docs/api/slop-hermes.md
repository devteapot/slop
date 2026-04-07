---
title: "slop-hermes"
description: "Hermes Agent plugin for discovering and controlling SLOP-enabled applications"
---
`slop-hermes` is a Python package that installs a Hermes plugin for SLOP app discovery and control.

It exposes five tools:

- `list_apps` — list available apps
- `connect_app` — connect and inspect an app
- `disconnect_app` — stop tracking an app
- `app_action` — perform a single action
- `app_action_batch` — perform multiple actions in one call

## Install

```bash
pip install slop-hermes
```

For local development from this repo:

```bash
pip install -e /path/to/slop/packages/python/slop-hermes
```

Install it into the same Python environment as Hermes.

## How it works

The package registers a `hermes_agent.plugins` entry point named `slop`.

At runtime it:

- starts a background `slop_ai.discovery.DiscoveryService`
- discovers local and browser-backed SLOP providers
- injects connected provider state through Hermes' `pre_llm_call` hook
- exposes a stable five-tool surface for app lifecycle and actions

## Discovery sources

- `~/.slop/providers/*.json`
- `/tmp/slop/providers/*.json`
- browser extension bridge at `ws://127.0.0.1:9339/slop-bridge`

## Environment variables

- `SLOP_HERMES_MAX_NODES` — max nodes included in injected state trees. Default: `160`
- `SLOP_HERMES_MIN_SALIENCE` — optional salience threshold for injected trees

## Operational notes

- Designed first for local CLI / single-user Hermes
- Uses stable meta-tools rather than per-affordance dynamic tools
- Builds on the mirrored Python discovery layer in `slop_ai.discovery`

## Related pages

- [Hermes integration guide](/guides/advanced/hermes)
- [Python SDK API](/api/python)
- [Discovery & Bridge](/sdk/discovery)
