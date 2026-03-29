---
title: "OpenClaw Integration"
---

SLOP providers can be controlled from any messaging channel — WhatsApp, Telegram, Slack, Discord, and more — through [OpenClaw](https://github.com/openclaw/openclaw), an open-source personal AI assistant. This document covers how the integration works, how to set it up, and the design decisions behind it.

## What it does

Any SLOP-enabled application running on your system becomes controllable through natural language from any messaging surface OpenClaw supports. The user doesn't need to know about SLOP — the protocol is invisible.

```
User (WhatsApp): "add a card called fix login bug to the backlog"

OpenClaw agent:
  → connected_apps("kanban") → sees board state + add_card action
  → app_action("slop-kanban", "/", "add_card", { column: "backlog", title: "fix login bug" })

User (WhatsApp): "Done, added 'fix login bug' to Backlog."
```

The agent sees your running apps, understands their state, and can act on them — just like it can browse the web or manage your calendar.

## Architecture

```
  Messaging channels                OpenClaw                    SLOP providers
┌──────────────────┐          ┌─────────────────┐          ┌──────────────────┐
│ WhatsApp         │          │                 │  unix     │ Clipboard Mgr    │
│ Telegram         │◄────────►│    Gateway       │◄────────►│ (Electron)       │
│ Slack            │  various │                 │  socket   │                  │
│ Discord          │  channel │  ┌───────────┐  │          ├──────────────────┤
│ iMessage         │  plugins │  │ SLOP      │  │  ws      │ Kanban Board     │
│ ...24+ channels  │          │  │ Plugin    │◄─┼─────────►│ (web app)        │
└──────────────────┘          │  └───────────┘  │          ├──────────────────┤
                              │                 │  unix     │ Pomodoro Timer   │
                              │  LLM engine     │◄────────►│ (desktop app)    │
                              └─────────────────┘  socket   └──────────────────┘
```

The SLOP plugin sits inside OpenClaw and:
1. **Discovers** SLOP providers by watching `~/.slop/providers/` for descriptor files
2. **Connects** to each provider via WebSocket or Unix socket
3. **Subscribes** to state trees for live updates
4. **Exposes** two tools the LLM uses to interact with providers

## The two tools

The plugin registers two tools with OpenClaw. The naming is intentionally generic — the agent and user interact with "apps", not "SLOP providers".

### `connected_apps`

View what applications are available and what they can do.

**Without arguments** — lists all connected apps:
```
Applications connected to this computer:
- Kanban Board (id: slop-kanban) — 15 actions available. 2 backlog, 1 in-progress, 2 done
- Clipboard Manager (id: slop-clipboard-manager) — 8 actions available. 5 entries, 2 favorited
```

**With an app name** — shows full state tree and every available action:
```
## Kanban Board
ID: slop-kanban

### Current State
[root] Kanban Board
  [collection] Backlog (count=2)
    [item] Design the API (color="#4a9eff")  actions: {move, edit, delete}
    [item] Write tests (color="#a855f7")  actions: {move, edit, delete}
  [collection] In Progress (count=1)
    [item] Build the MVP (color="#f59e0b")  actions: {move, edit, delete}

### Available Actions (15)
  - add_card on /: Add Card — Add a new card to a column
  - move on /backlog/card-1: Move Card — Move this card to another column
  ...
```

### `app_action`

Perform an action on a connected application.

```
app_action(
  app: "kanban",              // fuzzy match on name or ID
  path: "/",                  // target node in state tree
  action: "add_card",         // action name from connected_apps
  params: {                   // action parameters
    column: "backlog",
    title: "Fix login bug"
  }
)
```

Returns the result and updated state so the agent can confirm what happened.

## Why this design

### Why two meta-tools instead of one tool per affordance?

SLOP providers are **dynamic** — they start and stop, and their affordances change as state changes (new cards = new move targets). OpenClaw registers tools at plugin load time; there's no API to add/remove tools at runtime.

A kanban board with 5 cards exposes ~20 affordances. A clipboard with 50 entries: ~150+. Multiple providers would mean hundreds of tools — too many for an LLM to reason about effectively.

Two meta-tools handle any number of providers and affordances without tool explosion.

### Why no "SLOP" in tool names?

The user says "add a card to the kanban" — not "invoke slop_add_card on slop-kanban". The protocol should be invisible. Tool names like `connected_apps` and `app_action` match how users think about the interaction: "what apps do I have?" and "do something in that app."

### Why not inject state into the system prompt?

OpenClaw's context engine is an **exclusive slot** — taking it would block memory and other plugins. And full state trees from multiple providers would bloat the prompt even when the user isn't talking about apps. The tool-based approach is lazy: state is only fetched when the agent decides it's relevant.

### Why fuzzy name matching?

The `app` parameter accepts partial name matches ("kanban" matches "Kanban Board", "clipboard" matches "Clipboard Manager"). Users shouldn't need to remember exact IDs. The plugin resolves the best match.

## Setup

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- At least one SLOP-enabled application running on the system

### Install the plugin

```bash
# From local path (development)
openclaw plugins install --link /path/to/openclaw-plugin-slop

# From npm (once published)
openclaw plugins install openclaw-plugin-slop
```

### Verify

```bash
openclaw plugins inspect slop
```

Should show status `loaded` with tools `connected_apps` and `app_action`.

### Start a SLOP provider

```bash
# Any of the demo providers:
bun run demo:web       # Kanban board (WebSocket)
bun run demo:electron  # Pomodoro tracker (WebSocket)
bun run demo:unix-socket  # Clipboard manager (Unix socket)
```

Then chat with OpenClaw from any channel:
- "what apps are running on my computer?"
- "show me the kanban board"
- "add a card called 'fix auth' to backlog"
- "move 'Build the MVP' to done"

## Plugin internals

### Discovery service

The plugin watches `~/.slop/providers/` for JSON descriptor files. Each file declares a provider's ID, name, transport type, and connection details:

```json
{
  "id": "slop-kanban",
  "name": "SLOP Kanban Board",
  "slop_version": "0.1",
  "transport": { "type": "ws", "url": "ws://localhost:3737/slop" },
  "capabilities": ["state", "patches", "affordances"]
}
```

The service:
- Scans the directory on startup
- Watches for file changes (new providers, removed providers)
- Polls every 15 seconds as a fallback
- Auto-reconnects on disconnect (3-second delay)
- Cleans up connections when providers unregister

### Transport selection

| Descriptor `transport.type` | Transport used |
|---|---|
| `unix` | `NodeSocketClientTransport` — NDJSON over Unix domain socket |
| `ws` | `WebSocketClientTransport` — JSON over WebSocket |

Both transports are provided by `@slop-ai/consumer`.

### State synchronization

Each connected provider is subscribed at the root path with unlimited depth (`subscribe("/", -1)`). The consumer maintains a `StateMirror` that applies JSON patches as the provider's state changes. When the agent calls `connected_apps` or `app_action`, it reads the latest state from the mirror — no extra round-trip needed.

## Building SLOP-enabled apps for OpenClaw

Any application that implements the SLOP provider protocol works with this plugin automatically. The minimal integration:

```typescript
import { SlopProvider, UnixServerTransport } from "@slop-ai/provider";

const provider = new SlopProvider({
  id: "my-app",
  name: "My Application",
  capabilities: ["state", "affordances"],
  transport: new UnixServerTransport("/tmp/slop/my-app.sock"),
  register: true,  // auto-registers for discovery
});

provider.setTree(buildTree(appState));
provider.onInvoke("do_thing", (params) => { /* handle action */ });

await provider.start();
```

Once the app starts, OpenClaw discovers it within seconds and users can interact with it from any messaging channel.
