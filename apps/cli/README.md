# SLOP Inspector

A terminal UI for inspecting and debugging SLOP providers. Connect to any app that speaks SLOP, visualize its state tree in real-time, and invoke affordances manually — like Postman for the SLOP protocol.

## Setup

```bash
cd apps/cli && go build -o slop-inspect .
```

Or run directly:

```bash
cd apps/cli && go run .
```

## Usage

### Discovery mode

```bash
slop-inspect
```

Scans `~/.slop/providers/` and `/tmp/slop/providers/` for running providers, and discovers browser providers through the extension bridge. Select one to connect, or press `m` to enter an address manually.

Local providers are shown with a `●` marker, bridge providers with `◆`.

### Direct connect

```bash
# Unix socket
slop-inspect --connect /tmp/slop/tsk.sock

# WebSocket
slop-inspect --connect ws://localhost:3000/slop
```

### Extension bridge

The inspector supports the same extension bridge as the desktop app (`ws://127.0.0.1:9339/slop-bridge`). When the Chrome extension is connected, browser SLOP providers appear in the discovery list and can be controlled through the relay.

The bridge starts automatically. If the desktop app is already running, the CLI connects as a client to its bridge instead of starting its own server.

```bash
# Disable bridge
slop-inspect --bridge=false

# Use a different port
slop-inspect --bridge-port 9340
```

### Keyboard

| Key | Action |
|-----|--------|
| `j/k` or `arrows` | Navigate tree / scroll log |
| `tab` | Switch between tree and log panes |
| `enter` | Invoke affordance on selected node |
| `d` | Disconnect, return to discovery |
| `q` / `ctrl+c` | Quit |
| `m` | Manual address entry (discovery view) |

### Inspector view

The inspector has two panes:

**Tree** — the provider's live state tree, colorized by node type. Affordances are shown inline with a `⚡` marker. Navigate with `j/k` and press `enter` on any node with affordances to open the invoke form.

**Log** — real-time protocol messages. Every snapshot, patch, error, and event is timestamped and displayed as it arrives. Useful for understanding the patch flow during development.

### Invoking affordances

When you press `enter` on a node with affordances:

1. Select the action (cycle with `left/right` or `tab`)
2. Fill in parameters (if the action requires them)
3. Press `enter` to invoke
4. The result is shown inline, and the tree updates via patches

### Color conventions

Colors follow the SLOP design system ("Nocturnal Observer" palette):

| Node type | Color |
|-----------|-------|
| `root` | White, bold |
| `collection` | Blue |
| `item` | White |
| `notification` | Red |
| `status` | Gray |
| `control` | Green |
| `form` / `field` | Dark green |
| `group` | Muted |

Affordances are always green (`#91db37`). High-salience nodes are bold, low-salience nodes are dimmed. Urgent nodes are red.

## Testing SLOP applications

The inspector architecture is designed to support headless, automated testing of any SLOP provider — regardless of what language it's written in. See [TESTING.md](TESTING.md) for the full concept and planned approaches.

## Architecture

```
cli/
  main.go              Entry point, flags, bridge startup
  bridge/
    bridge.go          Bridge interface (server + client)
    server.go          WebSocket bridge server (ws://127.0.0.1:9339/slop-bridge)
    client.go          Bridge client (connects to existing bridge)
    relay.go           Relay transport (slop.ClientTransport over bridge)
  tui/
    app.go             Root model, view routing
    discovery.go       Provider discovery + bridge providers + manual address
    inspector.go       Tree viewport + event log + invoke overlay
    invoke.go          Affordance invocation form
    tree.go            Colorized tree renderer
    styles.go          Design system palette
    keys.go            Key bindings
  provider/
    discovery.go       Scans provider descriptor directories
    manager.go         Wraps slop.Consumer with async callbacks
```

The `provider/` package is fully decoupled from the TUI. The same `Manager` that powers the inspector can be used headless for automated testing — no terminal required.
