# OpenClaw SLOP Plugin

Control SLOP-enabled desktop and web applications from any messaging channel through [OpenClaw](https://openclaw.ai).

## What it does

Any SLOP-enabled application running on your system becomes controllable through natural language:

```
You (WhatsApp): "add a card called fix login bug to the backlog"

OpenClaw → connected_apps("kanban") → sees board state
OpenClaw → app_action("kanban", "/", "add_card", { column: "backlog", title: "fix login bug" })

OpenClaw: "Done, added 'fix login bug' to Backlog."
```

The plugin discovers SLOP providers automatically and exposes two tools:

- **`connected_apps`** — list connected apps or view a specific app's state and available actions
- **`app_action`** — perform an action on an app (add items, toggle state, delete, move, etc.)

## Install

Copy this plugin to your OpenClaw plugins directory, or install from ClawHub:

```bash
# From ClawHub (coming soon)
openclaw plugin install slop

# Or manually
cp -r extensions/openclaw-plugin-slop ~/.openclaw/plugins/slop
cd ~/.openclaw/plugins/slop && bun install
```

## How apps register

SLOP-enabled applications register themselves by creating a JSON descriptor in `~/.slop/providers/`:

```json
// ~/.slop/providers/my-app.json
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

The plugin watches this directory and connects automatically when new apps appear.

## Supported transports

| Transport | Config | Use case |
|---|---|---|
| Unix socket | `{ "type": "unix", "path": "/tmp/slop/app.sock" }` | Local desktop apps |
| WebSocket | `{ "type": "ws", "url": "ws://localhost:3737/slop" }` | Web apps |

## Configuration

In `openclaw.plugin.json`:

```json
{
  "autoConnect": true
}
```

- `autoConnect` (default: `true`) — automatically connect to discovered apps. Set to `false` to require manual connection.

## Example usage

```
> connected_apps
Applications connected to this computer:
- Kanban Board (id: slop-kanban) — 12 actions available
- Notes App (id: notes-app) — 8 actions available

> connected_apps("kanban")
## Kanban Board
### Current State
[root] Kanban Board
  [collection] Backlog (count=3)
    [item] Design the API  {move, edit, delete}
    [item] Write tests  {move, edit, delete}
  [collection] In Progress (count=1)
    [item] Build the MVP  {move, edit, delete}
  ...

> app_action("kanban", "/backlog/card-2", "move", { to_column: "in-progress" })
Done. move on /backlog/card-2 succeeded.
```

## Development

```bash
cd extensions/openclaw-plugin-slop
bun install
# Start a SLOP provider to test with
cd ../../mvp && bun run demo:web
```

## License

MIT
