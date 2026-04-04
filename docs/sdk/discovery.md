# Discovery & Bridge

SLOP consumers need to find and connect to providers. A consumer SDK handles the wire protocol (subscribe, query, invoke). The **discovery layer** sits above it and handles everything else: finding providers, managing connections, bridging browser tabs, and formatting state for AI consumption.

This document specifies the discovery layer's behavior in a language-agnostic way. Each SDK implements the same semantics in its own idioms.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Integration Layer (Claude plugin, OpenClaw, etc.)   │
│  Thin wrapper: exposes tools, injects context        │
└──────────────┬───────────────────────────────────────┘
               │ uses
┌──────────────▼───────────────────────────────────────┐
│  Discovery Layer                                      │
│  Provider scanning, bridge client/server,             │
│  relay transport, auto-connect, state formatting      │
└──────────────┬───────────────────────────────────────┘
               │ uses
┌──────────────▼───────────────────────────────────────┐
│  Consumer SDK                                         │
│  SlopConsumer: connect, subscribe, query, invoke      │
│  Transports: WebSocket, Unix socket, stdio            │
└──────────────────────────────────────────────────────┘
```

The consumer SDK is intentionally minimal — a pure SLOP protocol client with pluggable transports. The discovery layer adds the intelligence: where are providers, how do I connect to them, what if I need to bridge through an extension?

Integrations (Claude Code plugin, OpenClaw plugin, VS Code extension, custom agents) are thin wrappers that expose discovery capabilities to their specific host environment.

## Provider Discovery

### Local providers

Applications register themselves by writing a JSON descriptor file to `~/.slop/providers/`:

```json
{
  "id": "my-app",
  "name": "My Application",
  "slop_version": "0.1",
  "transport": {
    "type": "unix",
    "path": "/tmp/slop/my-app.sock"
  },
  "pid": 12345,
  "capabilities": ["state", "patches", "affordances"]
}
```

The discovery layer:

1. Scans `~/.slop/providers/*.json` on startup
2. Watches the directory for changes (file add/remove)
3. Re-scans periodically (every 15 seconds) as a fallback
4. Removes providers whose descriptor files disappear

Supported transport types in descriptors:

| Type | Field | Description |
|---|---|---|
| `unix` | `path` | Unix domain socket path |
| `ws` | `url` | WebSocket endpoint URL |
| `stdio` | — | Standard input/output (reserved for CLI tools) |

### Browser providers (via extension bridge)

Browser tabs running SLOP-enabled SPAs expose providers through the Chrome extension. The extension communicates with desktop consumers through a WebSocket bridge at `ws://127.0.0.1:9339/slop-bridge`.

Browser providers have two transport types:

| Transport | How it works | Consumer connects via |
|---|---|---|
| `ws` (server-backed) | Tab has its own WebSocket server | Direct WebSocket (no relay needed) |
| `postmessage` (SPA) | Tab uses `window.postMessage` | Relay through the extension bridge |

The discovery layer merges local and bridge providers into a single list. Consumers see a unified `ProviderDescriptor[]` regardless of source.

## Extension Bridge

### Protocol

The bridge is a WebSocket server that acts as a message hub between the browser extension and desktop consumers.

**Extension → Bridge:**

| Message | Purpose |
|---|---|
| `provider-available` | Announce a discovered browser tab provider |
| `provider-unavailable` | Tab closed or provider removed |
| `slop-relay` | Forward a SLOP message from a postMessage provider |

**Consumer → Bridge:**

| Message | Purpose |
|---|---|
| `relay-open` | Start relaying for a specific provider |
| `relay-close` | Stop relaying |
| `slop-relay` | Forward a SLOP message to a postMessage provider |

The bridge rebroadcasts all messages to all connected sinks. When a new client connects, the bridge replays all currently known providers.

### Bridge server fallback

Only one process can bind to the bridge port (default 9339). The discovery layer uses a **"try client first, fall back to server"** strategy:

```
1. Try connecting as a bridge client to ws://127.0.0.1:9339/slop-bridge
2. If connection succeeds → use client mode (Desktop or another consumer hosts the bridge)
3. If connection fails → start a bridge server on port 9339
4. If server bind fails (port race) → retry as client
```

This means:

- If the Desktop app is running, all other consumers connect as clients to its bridge
- If the Desktop app is NOT running, the first consumer to start becomes the bridge host
- Subsequent consumers connect as clients to whichever consumer started the bridge
- No separate daemon or installation required

The bridge server implementation must:

1. Accept WebSocket connections on the configured port and path
2. Store provider announcements and replay them to new connections
3. Forward all message types (`slop-relay`, `relay-open`, `relay-close`, `provider-available`, `provider-unavailable`) to all connected sinks
4. Track relay subscriptions per provider key for internal dispatch
5. Clean up relay subscriptions when providers go unavailable or connections close

### Relay transport

For `postmessage` providers, the discovery layer provides a relay transport that wraps the bridge connection as a standard `ClientTransport`:

1. Send `relay-open` to the bridge (extension activates content script relay)
2. Wait for the extension to activate (the content script needs to add its `window.addEventListener`)
3. Send SLOP `connect` handshake through the relay
4. Provider responds with `hello` through the relay
5. All subsequent SLOP messages flow through `slop-relay` wrappers

The relay transport implements the same `ClientTransport` interface as WebSocket or Unix socket transports. The `SlopConsumer` doesn't know it's talking through a relay — the transport is pluggable.

## Connection Management

### Lazy vs auto-connect

The discovery layer supports two modes:

- **Lazy connect** (default): Providers are discovered but not connected until explicitly requested via `ensureConnected(idOrName)`. Good for interactive tools where the user chooses which app to connect to.

- **Auto-connect**: All discovered providers are connected immediately on discovery. Good for background services (like an AI tool plugin) that need state available before the user asks.

### Idle timeout

Connected providers are disconnected after 5 minutes of inactivity to free resources. The timeout resets on any access (`getProvider`, `ensureConnected`, tool invocation).

### Reconnection

When a connected provider disconnects unexpectedly and its descriptor still exists, the discovery layer reconnects with exponential backoff:

- Initial delay: 3 seconds
- Backoff multiplier: 2x
- Maximum delay: 30 seconds
- Resets on successful reconnection

### Connection timeout

Connection attempts time out after 10 seconds. This prevents the discovery layer from hanging indefinitely on unresponsive providers (e.g., a descriptor file exists but the process isn't running).

## State Formatting

The discovery layer provides two functions for formatting provider state for AI consumption:

### `formatTree(node)`

Renders a state tree as a human-readable string:

```
[root] my-app: My Application
  [collection] items (total=3)
    [item] item-1: First Item (status="active")  actions: {edit(title: string), delete}
    [item] item-2: Second Item (status="done")  actions: {edit(title: string), delete}
  [view] settings  actions: {toggle_theme, export_data}
```

Includes node types, IDs, properties, affordances with parameter types, salience scores, and windowing indicators.

### `affordancesToTools(node)`

Converts all affordances in a state tree into LLM tool definitions:

- Tool names use `{nodeId}__{action}` format (e.g., `item_1__edit`)
- Collisions are disambiguated by prepending ancestor IDs
- Returns a `resolve(toolName)` function that maps tool names back to `{ path, action }` for `invoke`
- Tool descriptions include the node path, action label, and `[DANGEROUS]` flag

## State Change Notifications

The discovery layer fires a state change callback on:

- Provider connected
- Provider disconnected
- State patch received from any connected provider

Consumers can use this to maintain a cache, update a UI, or trigger context injection. The callback receives no arguments — the consumer reads the current state from the discovery service.

## SDK Implementations

| Language | Consumer SDK | Discovery Layer | Status |
|---|---|---|---|
| TypeScript | `@slop-ai/consumer` | `@slop-ai/claude-agent` (to be renamed `@slop-ai/discovery`) | Bridge client + server, relay, auto-connect, state cache |
| Python | `slop-ai` | — | Planned |
| Go | `slop-ai` | `apps/cli/bridge` + `apps/cli/provider` (to be extracted) | Bridge client + server exist in CLI, not packaged as library |
| Rust | `slop-ai` | `apps/desktop/src-tauri/src/bridge` (to be extracted) | Bridge server exists in Desktop, not packaged as library |

### Implementation checklist for new SDKs

A complete discovery layer implementation provides:

- [ ] Local provider scanning (`~/.slop/providers/`)
- [ ] Directory watching with periodic fallback scan
- [ ] Bridge client (connect to existing bridge)
- [ ] Bridge server (host bridge if none exists)
- [ ] "Try client, fall back to server" startup
- [ ] Relay transport for postMessage providers
- [ ] `formatTree()` for LLM context
- [ ] `affordancesToTools()` for LLM tool generation
- [ ] Auto-connect mode
- [ ] Lazy connect with `ensureConnected()`
- [ ] Idle timeout (5 minutes default)
- [ ] Exponential backoff reconnection
- [ ] Connection timeout (10 seconds)
- [ ] State change callback

## Related

- [Consumer SDK API](/api/consumer) — protocol client reference
- [Transport spec](../../spec/core/transport.md) — wire protocol and discovery mechanisms
- [Adapters spec](../../spec/integrations/adapters.md) — bridging non-SLOP apps
- [Consumer guide](/guides/consumer) — usage patterns and example workflows
