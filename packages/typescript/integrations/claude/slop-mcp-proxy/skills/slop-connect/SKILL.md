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
When connected to a SLOP app, its **state tree** is injected into your context on every message —
you always see the latest state, available actions, paths, and parameter schemas.

## Tools

### `discover_apps`

Lists all discovered applications.

- **No arguments** — lists all available apps (local native + web), their connection status, and action counts.

### `connect_app`

Connects to a specific app and returns its full state tree.

- **`app: "name or id"`** — connects to the app (if not already connected) and returns its full state tree.

### `disconnect_app`

Disconnect from an app. Stops state updates and removes it from context.

- **`app: "name or id"`** — the app to disconnect from.

### `app_action`

Perform a single action on an app. Read the state tree in your context to find the correct paths, action names, and parameter schemas.

- **`app`** — app name or ID
- **`path`** — path to the node to act on (e.g. `"/"`, `"/todos/todo-1"`, `"/canvas"`)
- **`action`** — action name (e.g. `"add_card"`, `"toggle"`, `"delete"`)
- **`params`** — action parameters as key-value pairs (optional, depends on the action schema)

### `app_action_batch`

Perform multiple actions in a single call. Much faster than calling `app_action` repeatedly.

- **`app`** — app name or ID
- **`actions`** — array of `{ path, action, params }` objects to execute sequentially

Use this for bulk operations: adding multiple items, making several edits, or any multi-step workflow.

## Workflow

### 1. Discover and list apps

Call `discover_apps` to see what's available. Apps are auto-discovered from:
- `~/.slop/providers/` — local native apps
- The SLOP browser extension bridge — web apps running in the browser

### 2. Connect

Call `connect_app` with an app name or ID. This connects and returns the full state tree.

### 3. Read state from context

After connecting, the app's state tree appears in your context automatically on every message.
The state tree shows you:
- All nodes with their types, properties, and paths
- Available actions on each node with parameter signatures
- Salience hints indicating what's important right now

**Use this information to construct `app_action` calls.** The paths and action names in context
are exactly what you pass to the tool.

### 4. Act

Call `app_action` with the `app`, `path`, `action`, and `params` from the state tree.

Example — adding a card to a kanban board:
```
app_action(app="kanban", path="/columns/todo", action="add_card", params={"title": "Fix bug", "priority": "high"})
```

For multiple actions, use `app_action_batch`:
```
app_action_batch(app="kanban", actions=[
  {"path": "/columns/todo", "action": "add_card", "params": {"title": "Task 1"}},
  {"path": "/columns/todo", "action": "add_card", "params": {"title": "Task 2"}},
  {"path": "/columns/done/card-5", "action": "archive"}
])
```

### 5. State stays current

Connected apps' state is automatically injected into your context on every user message via a hook.
You always see the latest state without needing to re-fetch.

### 6. Disconnect

When you're done with an app, call `disconnect_app` to stop state updates. Only disconnect when
explicitly asked — the connection persists across messages.

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
- **Actions** — affordances available on that node, with parameter signatures. **These are the action names and params you use with `app_action`.**
- **Windowing** — `(showing N of M)` means a large collection is partially loaded

### Content references

Some nodes have large content (documents, files) not inlined. You'll see:
```
content: text/typescript, 12.4 KB
summary: "TypeScript module. Exports SLOP client."
```

Invoke the `read_content` action on that node to load the full content.

## Multi-App Workflows

Connect to multiple apps simultaneously. Each app's state appears separately in context with
its own namespace. Use the `app` parameter in `app_action` to target the right app.

Example: connect to both a kanban board and a chat app, then create a card from a chat message.

## Async Actions

Some actions take time (deploys, report generation). When you invoke one:
1. You get an immediate response indicating acceptance
2. A task node appears in the state tree with progress updates
3. The task node may have a `cancel` action
4. Report progress to the user as it updates

## Important Notes

- **Dangerous actions** — actions marked `[DANGEROUS]` require user confirmation. Always ask the user first.
- **State is live** — the tree updates in real time via patches. What you see is current.
- **Inspect before acting** — always call `connect_app` with an app name before using `app_action` so you have the current state.
- **Batch for speed** — use `app_action_batch` for multiple actions instead of calling `app_action` sequentially.
- **Summaries are valuable** — stub nodes with summaries often tell you enough without loading full details.

For more details on the SLOP protocol, see `references/protocol-overview.md`.
