# `slop-hermes`

Hermes Agent plugin for the [SLOP protocol](https://slopai.dev).

This package adds a fixed 5-tool SLOP integration to Hermes:

- `list_apps`
- `connect_app`
- `disconnect_app`
- `app_action`
- `app_action_batch`

It also injects connected SLOP app state into each Hermes turn so the model can
see live state before calling actions.

## Install

Install into the same Python environment as Hermes:

```bash
pip install slop-hermes
```

For local development from this repo:

```bash
pip install -e /path/to/slop/packages/python/slop-hermes
```

Hermes discovers the plugin through the `hermes_agent.plugins` entry point.

Verify the plugin is visible:

```bash
hermes plugins list
```

If you explicitly manage toolsets, enable `slop` in `hermes tools` or include it in your session:

```bash
hermes chat --toolsets slop,web,terminal
```

## How it works

- starts a background `slop_ai.discovery.DiscoveryService`
- discovers local providers from `~/.slop/providers/*.json` and `/tmp/slop/providers/*.json`
- connects to browser-backed providers through the extension bridge at `ws://127.0.0.1:9339/slop-bridge`
- injects connected app state into Hermes through the `pre_llm_call` hook
- performs actions through the fixed `app_action` and `app_action_batch` tools

## Environment variables

- `SLOP_HERMES_MAX_NODES` — max nodes included in injected trees. Default: `160`
- `SLOP_HERMES_MIN_SALIENCE` — optional salience threshold for injected trees

## Notes

- This first version is designed primarily for local CLI / single-user Hermes.
- Browser bridge and direct WebSocket discovery use `slop-ai[websocket]`, which
  is installed automatically with this package.
