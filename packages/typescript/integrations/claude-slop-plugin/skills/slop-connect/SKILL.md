---
name: slop-connect
description: >
  Connect to SLOP-enabled applications and interact with them in real time.
  Use when the user asks to "connect to an app", "open an app", "interact with",
  "use", "control", or "check" a local application, or when the user mentions
  a specific app that might be SLOP-enabled (e.g., "check my kanban board",
  "look at my editor", "what's in my inbox"). Also triggers on "discover apps",
  "list providers", "available apps", or "SLOP".
---

# Connecting to SLOP Apps

SLOP (Semantic Live Observable Protocol) lets apps expose their live state and actions to you.
When connected to a SLOP app, you receive its **state tree** (what the app is right now) and
**affordances** (what you can do), both of which update in real time.

## Tools

You have three tools for working with SLOP apps:

### `connected_apps`

Lists all discovered applications, or shows detailed state for a specific app.

- **No arguments** — lists all available apps (local native + web), their connection status, and action counts.
- **`app: "name or id"`** — connects to the app (if not already connected) and returns its full state tree and all available actions with their paths and parameters.

### `app_action`

Performs a single action on an app. Parameters:

- `app` — app name or ID (from `connected_apps`)
- `path` — path to the node to act on (e.g. `/`, `/todos/todo-1`)
- `action` — the action name (e.g. `add_card`, `toggle`, `delete`)
- `params` — optional key-value parameters for the action

### `app_action_batch`

Performs multiple actions in one call — much faster than calling `app_action` repeatedly.

- `app` — app name or ID
- `actions` — array of `{ path, action, params }` objects to execute sequentially

## Workflow

### 1. Discover and list apps

Call `connected_apps` (no arguments) to see what's available. Apps are auto-discovered from:
- `~/.slop/providers/` — local native apps
- The SLOP browser extension bridge — web apps running in the browser

### 2. Connect and inspect

Call `connected_apps` with an app name or ID. This lazy-connects if needed and returns the full state tree plus all available actions. Always do this before acting — it shows you the exact node paths and action names.

### 3. Act

Use `app_action` or `app_action_batch` to perform actions. Use the exact paths and action names from the state tree — don't guess.

### 4. State stays current

Connected apps' state is automatically injected into your context on every user message via a hook. You always see the latest state without needing to re-fetch.

## Reading the State Tree

The state tree uses a canonical text format:

```
[type] id: Label (key=value, ...)  — "summary"  salience=0.90  actions: {action1(param: type), action2}
  [type] child-id: Child Label (...)
    ...
```

Key elements:
- **Type** — semantic role: `root`, `view`, `collection`, `item`, `document`, `form`, `field`, `control`, `status`, `notification`, `context`
- **Salience** — 0 to 1, how important this node is right now. Focus on high-salience nodes.
- **Summary** — quoted text giving an overview of collapsed subtrees
- **Actions** — affordances available on that node, with parameter signatures
- **Windowing** — `(showing N of M)` means a large collection is partially loaded

### Content references

Some nodes have large content (documents, files) not inlined. You'll see:
```
content: text/typescript, 12.4 KB
summary: "TypeScript module. Exports SLOP client."
```

Invoke the `read_content` action on that node to load the full content.

## Multi-App Workflows

Connect to multiple apps simultaneously. Call `connected_apps` with each app name to connect, then use `app_action` targeting different apps. The injected context shows all connected providers' state.

Example: connect to both a kanban board and a chat app, then create a card from a chat message.

## Async Actions

Some actions take time (deploys, report generation). When you invoke one:
1. You get an immediate response indicating acceptance
2. A task node appears in the state tree with progress updates
3. The task node may have a `cancel` action
4. Report progress to the user as it updates

## Important Notes

- **Dangerous actions** — actions marked as dangerous require user confirmation. Always ask the user first.
- **State is live** — the tree updates in real time via patches. What you see is current.
- **Inspect before acting** — always call `connected_apps` with an app name before using `app_action` so you have the exact paths and action names.
- **Summaries are valuable** — stub nodes with summaries often tell you enough without loading full details.

For more details on the SLOP protocol, see `references/protocol-overview.md`.
