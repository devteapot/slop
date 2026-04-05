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
its affordances become **first-class tools** that you call directly.

## Permissions

If the user is prompted to approve every tool call, suggest they add this to `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["mcp__plugin_claude-slop-native_slop-bridge__*"]
  }
}
```

This auto-allows all tools from this plugin — lifecycle tools and dynamic app affordance tools.

## Tools

### Lifecycle tools (always available)

#### `discover_apps`

Lists all discovered applications.

- **No arguments** — lists all available apps (local native + web), their connection status, and action counts.

#### `connect_app`

Connects to a specific app and returns its full state tree.

- **`app: "name or id"`** — connects to the app (if not already connected) and returns its full state tree. **Connecting also registers all app affordances as dynamic tools.**

#### `disconnect_app`

Explicitly disconnect from an app. Removes its dynamic tools and stops state updates.

- **`app: "name or id"`** — the app to disconnect from.

### Dynamic affordance tools (per-app, after connecting)

When you connect to an app, its affordances are registered as first-class tools. For example, connecting to Excalidraw might give you:

- `excalidraw__canvas__zoom_to_fit()`
- `excalidraw__elements__add_rectangle(x, y, width, height, stroke_color, background_color)`
- `excalidraw__elements__add_text(x, y, text, font_size)`

**Call these directly** — they are real tools with proper parameter schemas. No need to use meta-tools or assemble path/action/params manually.

You can call multiple affordance tools **in parallel** in a single response for maximum speed.

## Workflow

### 1. Discover and list apps

Call `discover_apps` to see what's available. Apps are auto-discovered from:
- `~/.slop/providers/` — local native apps
- The SLOP browser extension bridge — web apps running in the browser

### 2. Connect

Call `connect_app` with an app name or ID. This connects and returns the full state tree. Dynamic tools are registered automatically — you'll see them available for use.

### 3. Act

Use the dynamic affordance tools directly. The state tree in your context shows you what tools are available, their parameters, and the current state of every node.

Call multiple tools in parallel when performing batch operations.

### 4. State stays current

Connected apps' state is automatically injected into your context on every user message via a hook. You always see the latest state without needing to re-fetch.

### 5. Disconnect

When you're done with an app, call `disconnect_app` to remove its tools and stop state updates. Only disconnect when explicitly asked — the connection persists across messages.

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

Connect to multiple apps simultaneously. Call `connect_app` with each app name to connect. Each app's affordances are registered as separate namespaced tools, so there are no collisions.

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
- **Inspect before acting** — always call `connect_app` with an app name before using affordance tools so you have the current state and know which tools are available.
- **Parallel calls** — use parallel tool calls for batch operations instead of calling sequentially.
- **Summaries are valuable** — stub nodes with summaries often tell you enough without loading full details.

For more details on the SLOP protocol, see `references/protocol-overview.md`.
