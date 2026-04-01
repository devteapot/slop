---
title: Consumer Guide
description: Tools for connecting to, inspecting, and testing SLOP providers
---

A SLOP **consumer** connects to a provider, subscribes to its state tree, and can invoke affordances. SLOP ships three consumer tools out of the box — use them to test your provider during development, debug protocol issues, or build AI-powered workflows.

## Which consumer to use

| Consumer | Best for | Transport |
|----------|----------|-----------|
| [CLI Inspector](#cli-inspector) | Development, debugging, CI testing | Unix socket, WebSocket |
| [Desktop App](#desktop-app) | Multi-provider AI chat, workspace management | Unix socket, WebSocket, browser bridge |
| [Chrome Extension](#chrome-extension) | Testing web/SPA providers in the browser | postMessage, WebSocket |

During development, **start with the CLI** — it's the fastest way to verify your tree, patches, and affordances are correct. Add the desktop app when you want AI chat across multiple providers. Use the extension for browser-based SPAs.

## CLI Inspector

A terminal UI for real-time inspection and manual testing of any SLOP provider. Think Postman for the SLOP protocol.

### Install

```bash
cd cli && go build -o slop-inspect .
```

Or run directly:

```bash
cd cli && go run .
```

### Connect to a provider

```bash
# Auto-discover local providers
slop-inspect

# Direct connect via Unix socket
slop-inspect --connect /tmp/slop/myapp.sock

# Direct connect via WebSocket
slop-inspect --connect ws://localhost:3000/slop
```

### What you get

**Tree pane** — your provider's live state tree, updating in real-time as patches arrive. Nodes are colorized by type, high-salience nodes are bold, and affordances show inline with a `⚡` marker.

**Log pane** — timestamped protocol events: snapshots, errors, invocations and their results.

**Invoke overlay** — press `enter` on any node with affordances to open a form, select an action, fill parameters, and fire it.

### Development workflow

1. Start your provider (e.g., `go run .` or `bun dev`)
2. In another terminal, run `slop-inspect`
3. Select your provider from the discovery list (or `--connect` directly)
4. Verify the tree structure matches what you expect
5. Navigate to nodes and invoke affordances to test them
6. Watch the tree and log panes to confirm patches arrive correctly

### Keyboard

| Key | Action |
|-----|--------|
| `j/k` or arrows | Navigate tree / scroll log |
| `tab` | Switch between tree and log panes |
| `enter` | Invoke affordance on selected node |
| `d` | Disconnect, return to discovery |
| `m` | Manual address entry (discovery view) |
| `q` | Quit |

## Desktop App

A multi-provider AI workspace. Connects to local apps, web apps, and browser tabs simultaneously. An AI sees all connected providers at once and can act across them.

### Install

```bash
cd desktop
bun install
bunx tauri dev
```

### Key features

- **Workspaces** — organize providers into tabs, each with its own chat and connections
- **Unified chat** — AI sees all connected providers, can invoke affordances across apps
- **Provider discovery** — auto-finds local providers via `~/.slop/providers/`
- **Browser bridge** — sees browser providers announced by the Chrome extension (at `ws://localhost:9339`)
- **State tree viewer** — inspect the live SLOP tree for any connected provider

### When to use during development

The desktop app is most useful when your provider is mature enough to test with AI:

- Verify the AI can understand your tree structure and affordance descriptions
- Test multi-provider scenarios (e.g., a kanban board + pomodoro timer)
- Check that your `meta.summary` and affordance labels read well to an LLM

## Chrome Extension

Discovers SLOP providers on web pages and provides an AI chat overlay. Also bridges browser providers to the desktop app.

### Install (sideload)

```bash
cd extension
bun install && bun run build.ts
```

Then in Chrome: `chrome://extensions` > Developer mode > Load unpacked > select `extension/`.

### How it works

1. Navigate to a SLOP-enabled web app
2. The extension auto-detects the `<meta name="slop">` tag
3. A chat button appears — click to open the AI panel
4. The AI sees the page's SLOP tree and can invoke actions

### When to use during development

- **SPA providers** — if your provider uses postMessage transport, the extension is the primary way to test it
- **Web app providers** — verify the `<meta name="slop">` tag is discoverable and the WebSocket endpoint connects correctly
- **Bridge testing** — enable "Desktop bridge" in the extension popup to test the desktop app seeing your browser providers

## Building a custom consumer

Use the consumer SDKs to build your own integrations — bots, agents, CLI automations:

**TypeScript:**
```typescript
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new WebSocketClientTransport("ws://localhost:3000/slop")
);
await consumer.connect();
const { tree } = await consumer.subscribe("/");
const result = await consumer.invoke("/todos", "create", { title: "New task" });
```

**Go:**
```go
consumer := slop.NewConsumer(&slop.WSClientTransport{URL: "ws://localhost:3000/slop"})
hello, _ := consumer.Connect(ctx)
subID, tree, _ := consumer.Subscribe(ctx, "/", -1)
result, _ := consumer.Invoke(ctx, "/todos", "create", slop.Params{"title": "New task"})
```

See the [@slop-ai/consumer API reference](/api/consumer) for the full TypeScript SDK, or the [Go guide](/guides/go) for the Go SDK.
