# claude-slop-connect

Connect Claude to any SLOP-enabled application — local native apps and web apps alike. Discovers providers, subscribes to live state trees, and exposes app affordances as tools so Claude can see and act on your apps in real time.

## What it does

SLOP (Semantic Live Observable Protocol) is a standard for apps to expose their state and actions to AI systems. This plugin bridges SLOP providers to Claude:

- **Discovers** SLOP-enabled apps — both local native apps and web apps running in the browser
- **Connects** via WebSocket, Unix socket, or extension relay (for browser-only SPAs)
- **Injects state** directly into Claude's context on every message — no manual fetching
- **Exposes actions** through three tools: `connected_apps`, `app_action`, `app_action_batch`
- **Supports multiple apps** connected simultaneously for cross-app workflows

## Setup

After installing the plugin, install the MCP server dependencies:

```bash
cd <plugin-directory>/servers
npm install
```

### Local apps

The plugin auto-discovers SLOP providers from:
- `~/.slop/providers/` (user-level)
- `/tmp/slop/providers/` (session-level)

### Web apps (via browser extension)

To discover and interact with SLOP-enabled web apps, install the SLOP browser extension. The plugin automatically connects to the extension's local bridge at `ws://127.0.0.1:9339/slop-bridge` and receives provider announcements as you browse.

Two types of web providers are supported:
- **WebSocket providers** — server-backed web apps. The plugin connects directly to the app's WebSocket endpoint.
- **postMessage providers** — client-only SPAs. The plugin communicates through the extension relay.

Both types appear seamlessly in discovery results and work identically once connected.

## Usage

Ask Claude to interact with a SLOP-enabled app:

- "What apps are available?" — discovers local + web providers
- "Connect to my kanban board" — connects and shows state
- "What's in my inbox?" — reads state from a connected mail app
- "Archive that message" — invokes an action on a node
- "Add three tasks to my todo list" — batch action

## Tools

| Tool | Purpose |
|------|---------|
| `connected_apps` | List all discovered apps, or connect to a specific app and view its full state tree and available actions |
| `app_action` | Perform a single action on an app node (path + action + params) |
| `app_action_batch` | Perform multiple actions on an app in a single call |

## Components

| Component | Purpose |
|-----------|---------|
| **MCP Server** (`slop-bridge`) | Thin MCP wrapper around the `@slop-ai/claude-agent` SDK — manages discovery, connections, and translates tool calls |
| **Skill** (`slop-connect`) | Teaches Claude the SLOP workflow: discover, connect, read state, act |
| **Hook** (`UserPromptSubmit`) | Injects connected providers' state into Claude's context each turn |

## How it works

1. The MCP server uses `createDiscoveryService` from `@slop-ai/claude-agent` to discover SLOP providers from the local filesystem and the browser extension bridge.
2. When Claude calls `connected_apps` with an app name, the SDK lazy-connects via the appropriate transport (WebSocket, Unix socket, or extension relay) and subscribes to the state tree.
3. `createToolHandlers` from the SDK provides the logic for all three tools — listing apps, invoking actions, and batch actions.
4. The `UserPromptSubmit` hook reads a shared state file (`/tmp/claude-slop-connect/state.json`) that the MCP server updates whenever state changes, injecting live state into Claude's context.
5. State formatting uses `formatTree` from `@slop-ai/consumer` for consistent, readable output.

## Architecture

```
Local native apps ──Unix socket / WebSocket──┐
                                              │
Server-backed web apps ──direct WebSocket─────┤
                                              ├── slop-bridge (MCP server) ←→ Claude
Browser SPAs ──postMessage──Extension─────────┤
                     (relay via bridge)       │
                                              │
                 @slop-ai/claude-agent SDK ───┘
                   ├── createDiscoveryService (discovery + connections)
                   ├── createToolHandlers (tool logic)
                   └── createBridgeClient (extension relay)
```

## Requirements

- Node.js 18+
- npm (for installing server dependencies)
- One or more SLOP-enabled applications (local or web)
- For web apps: the SLOP browser extension

## Learn more

- [SLOP Protocol Spec](https://github.com/nichochar/slop-spec) — the full protocol specification
- [`@slop-ai/consumer`](https://www.npmjs.com/package/@slop-ai/consumer) — SLOP consumer SDK
- [`@slop-ai/claude-agent`](https://www.npmjs.com/package/@slop-ai/claude-agent) — Claude agent integration SDK
