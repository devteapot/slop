---
title: "Discovery & Bridge"
description: "Provider scanning, extension bridge, relay transport, auto-connect, state formatting"
---
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

### TypeScript package exports (`@slop-ai/discovery`)

| Entry | Purpose |
|---|---|
| `@slop-ai/discovery` | **Default.** Discovery service, bridge, relay, CLI, and agent-agnostic helpers: `createToolHandlers`, `createDynamicTools`, `createStateCache`, etc. No Anthropic-specific dependency at import time for these APIs. |
| `@slop-ai/discovery/anthropic-agent-sdk` | **Optional.** `createSlopAgentTools` and `createSlopMcpServer` for [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) (`query()`, programmatic MCP). Use only when wiring the Anthropic Agent SDK. |

Integrations that only need discovery + MCP (e.g. `slop-bridge` with the MCP SDK) import from the **default** export and do not need `anthropic-agent-sdk`.

## Provider Discovery

### Local providers

Applications register themselves by writing a JSON descriptor file to one of two directories:

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

| Directory | Purpose |
|---|---|
| `~/.slop/providers/` | Persistent user-level providers (desktop apps, daemons) |
| `/tmp/slop/providers/` | Session-level ephemeral providers (dev servers, CLI tools) |

The discovery layer:

1. Scans both directories for `*.json` files on startup
2. Watches both directories for changes (file add/remove)
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

### `createDynamicTools(discovery)`

Builds namespaced tool definitions from all connected providers' affordances. Each tool name is prefixed with the provider's ID to avoid cross-app collisions:

```
kanban__backlog__add_card     → invoke("/columns/backlog", "add_card", ...)
kanban__col_1__move_card      → invoke("/columns/col-1", "move_card", ...)
chat__messages__send          → invoke("/messages", "send", ...)
```

Returns a `DynamicToolSet` with:
- `tools` — array of `DynamicToolEntry` objects (name, description, inputSchema, providerId, path, action)
- `resolve(toolName)` — maps a dynamic tool name back to `{ providerId, path, action }` for dispatch

This function is called on every state change to rebuild the tool list. Integrations that support dynamic tool registration (like MCP's `notifications/tools/list_changed`) use this to expose affordances as first-class tools. See [Dynamic tool injection](#dynamic-tool-injection) below.

## State Change Notifications

The discovery layer fires a state change callback on:

- Provider connected
- Provider disconnected
- State patch received from any connected provider

Consumers can use this to maintain a cache, update a UI, or trigger context injection. The callback receives no arguments — the consumer reads the current state from the discovery service.

## SDK Implementations

| Language | Consumer SDK | Discovery Layer | Status |
|---|---|---|---|
| TypeScript | `@slop-ai/consumer` | `@slop-ai/discovery` | Bridge client + server, relay, auto-connect, state cache |
| Python | `slop-ai` | — | Planned |
| Go | `slop-ai` | `apps/cli/bridge` + `apps/cli/provider` (to be extracted) | Bridge client + server exist in CLI, not packaged as library |
| Rust | `slop-ai` | `apps/desktop/src-tauri/src/bridge` (to be extracted) | Bridge server exists in Desktop, not packaged as library |

### Implementation checklist for new SDKs

A complete discovery layer implementation provides:

- [ ] Local provider scanning (`~/.slop/providers/` + `/tmp/slop/providers/`)
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
- [ ] Dynamic tool generation (`createDynamicTools()` equivalent)
- [ ] State injection for host context (hook or prompt prepend)

## Integrations

Both the Claude Code and OpenClaw plugins follow the same design principles:

- **State injection** — Provider state is injected into the model's context before each turn, not fetched via tool calls
- **Minimal tool usage** — Tools are used only for connecting to apps and performing actions, never for reading state
- **Shared discovery** — Both import `@slop-ai/discovery` for provider scanning, bridge, and relay

Where they differ is **action dispatch**, due to host platform limitations.

### Dynamic tool injection

When a host supports runtime tool registration, the discovery layer can expose each affordance as a first-class tool. `createDynamicTools(discovery)` generates namespaced tool definitions from all connected providers:

```
kanban__backlog__add_card({title: "Ship docs"})    ← model calls this directly
```

Instead of:

```
app_action(app="kanban", path="/columns/backlog", action="add_card", params={title: "Ship docs"})
```

Dynamic tools have proper parameter schemas from the provider's affordance definitions. They are rebuilt on every state change (affordance added/removed, provider connect/disconnect).

**Host support:**

| Host | Dynamic tools | Mechanism | Limitation |
|---|---|---|---|
| Claude Code (MCP) | Yes | `notifications/tools/list_changed` — server notifies client when tool list changes | None |
| OpenClaw | No | `api.registerTool()` is one-time during `register()` | No runtime tool registration API; tools must be declared in the plugin manifest |

Hosts without dynamic tool support fall back to the **meta-tool pattern**: stable tools (`app_action`, `app_action_batch`) that resolve actions at runtime. The model knows exact paths and action names from state injection, so it gets the call right without guessing.

### Claude Code integrations (`claude-slop-native`, `claude-slop-mcp-proxy`)

| Variant | Purpose |
|---|---|
| **`claude-slop-native`** | Wraps `createDiscoveryService` + `createDynamicTools` from `@slop-ai/discovery`. Registers dynamic per-app tools via `tools/list_changed`. Static tools: `discover_apps`, `connect_app`, `disconnect_app`. |
| **`claude-slop-mcp-proxy`** | Wraps `createDiscoveryService` from `@slop-ai/discovery`, but keeps a fixed tool catalog: `discover_apps`, `connect_app`, `disconnect_app`, `app_action`, `app_action_batch`. |
| **Shared hook** (`UserPromptSubmit`) | Reads a shared state file and injects connected providers' state trees into Claude's context on every user message — no MCP fetch needed. Also lists discovered-but-not-connected apps. |
| **Shared skill** (`slop-connect`) | Teaches Claude the discover → connect → inspect → act workflow. |

Design details:

- **Native direct tools** — When `connect_app("kanban")` connects a provider, `claude-slop-native` registers affordances as MCP tools (e.g., `kanban__add_card`). Claude calls them directly. When the provider disconnects, the tools are removed.
- **MCP proxy fallback** — `claude-slop-mcp-proxy` does not register dynamic tools. Instead, Claude reads state from context and calls `app_action(app, path, action, params)` or `app_action_batch(...)`.
- **Live state in context** — Both variants write provider state to `/tmp/claude-slop-plugin/state.json` on every state change. The hook reads this file and outputs markdown that Claude sees on every turn.
- **Staleness protection** — The state file includes a `lastUpdated` timestamp. The hook skips injection if the file is older than 30 seconds.
- **Multi-app** — Multiple providers can be connected simultaneously. In the native variant, dynamic tools from different apps are distinguished by their app ID prefix.

See [Claude Code guide](/guides/advanced/claude-code) for setup and usage.

### OpenClaw plugin (`@slop-ai/openclaw-plugin`)

| Component | Purpose |
|---|---|
| **Tools** | `discover_apps` (list), `connect_app` (connect/inspect), `disconnect_app`, `app_action` (single action), `app_action_batch` (bulk ops) — registered once during `register()` |
| **Hook** (`before_prompt_build`) | Injects connected providers' state trees as `prependContext` on every inference turn |

Design details:

- **Meta-tool pattern** — OpenClaw's plugin SDK requires tools to be declared upfront in `openclaw.plugin.json` and registered once. Dynamic tool registration is not supported. Actions go through `app_action(app, path, action, params)` instead of per-app tools.
- **State injection** — The `before_prompt_build` hook returns `{ prependContext: stateMarkdown }`, which OpenClaw prepends to the conversation before inference. No file-based IPC needed (in-process).
- **Discovery** — Uses `@slop-ai/discovery` with bridge support. Discovers local providers, session providers, and browser tabs via extension bridge.

See [OpenClaw guide](/guides/advanced/openclaw) for setup and usage.

## Related

- [Consumer SDK API](/api/consumer) — protocol client reference
- [Transport spec](/spec/core/transport) — wire protocol and discovery mechanisms
- [Adapters spec](/spec/integrations/adapters) — bridging non-SLOP apps
- [Consumer guide](/guides/consumer) — usage patterns and example workflows
- [Claude Code guide](/guides/advanced/claude-code) — Claude Code plugin setup and usage
