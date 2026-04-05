---
name: slop-connect
description: Connect Codex to SLOP-enabled applications and interact with them in real time. Use when the user asks to list apps, connect to an app, inspect a local or browser app, or control software that exposes SLOP state and actions.
metadata:
  priority: 8
  pathPatterns:
    - '.mcp.json'
    - 'packages/typescript/integrations/codex/slop/**'
  bashPatterns:
    - '\blist_apps\b'
    - '\bconnect_app\b'
    - '\bdisconnect_app\b'
    - '\bapp_action(_batch)?\b'
retrieval:
  aliases:
    - slop
    - slop app control
    - connect to app
    - list available apps
    - control local app
  intents:
    - connect to an app
    - inspect app state
    - control a desktop app
    - control a browser app
  entities:
    - SLOP
    - list_apps
    - connect_app
    - disconnect_app
    - app_action
    - app_action_batch
---

# Connecting Codex to SLOP Apps

SLOP (Semantic Live Observable Protocol) lets apps expose their live semantic state and actions to AI systems.
This Codex plugin gives you five stable MCP tools for discovering apps, connecting them once, and invoking affordances while live state stays injected into future user turns.

## Tools

### `list_apps`

Lists SLOP-enabled apps currently available on this computer, including:

- local native apps discovered from `~/.slop/providers/`
- session-scoped apps discovered from `/tmp/slop/providers/`
- browser-announced apps discovered through the SLOP extension bridge

### `connect_app`

Connects to an app and returns:

- the current formatted state tree
- a summarized list of available actions

This is the connection step. After an app is connected, the plugin injects its live state into future user prompts automatically. Call `connect_app` when you want to connect a new app, reconnect a dropped app, or force an immediate same-turn snapshot.

### `disconnect_app`

Disconnects from an app when you're done. Connections may also time out when idle.

### `app_action`

Performs one affordance on an app using:

- `app`
- `path`
- `action`
- optional `params`

Use the exact path and action names that `connect_app` showed you or that the injected `## SLOP Apps` context shows on later turns.

### `app_action_batch`

Performs multiple affordances in one call. Prefer this when you need to add or update several things because it is faster and more reliable than issuing many single-action calls.

## Workflow

1. Call `list_apps` to discover what's available.
2. Call `connect_app("name-or-id")` once to connect the target app and get an immediate snapshot.
3. In the same turn, read the returned state tree carefully.
4. On later turns, read the injected `## SLOP Apps` context before acting.
5. Call `app_action` or `app_action_batch` with the exact paths and actions from the current tree.
6. Re-run `connect_app` only when the app is not connected yet, looks stale, or needs to be reconnected.
7. Call `disconnect_app` only when explicitly asked or when the task is clearly complete.

## Reading the state tree

The tree uses the canonical SLOP text format:

```
[type] id: Label (key=value, ...)  — "summary"  salience=0.90  actions: {action1(param: type), action2}
  [type] child-id: Child Label (...)
```

Focus on:

- node labels and IDs
- high-salience nodes
- affordances shown in `actions: {...}`
- summaries on collapsed or windowed content

## Important guidance

- Inspect before acting. Do not guess action names or paths.
- Treat injected `## SLOP Apps` context as the default source of truth on later turns.
- Use the `connect_app` tool output as the source of truth in the same turn you first connect.
- Use `app_action_batch` for repeated or bulk edits.
- If an action is marked dangerous, ask the user before calling it.
- Multiple apps can stay connected at once for cross-app workflows.
- If a connection has gone stale, disappeared from injected context, or the app changed significantly, refresh with `connect_app`.
