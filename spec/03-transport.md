# 03 — Transport & Discovery

SLOP is transport-agnostic. The protocol defines message semantics (see [04 — Messages](./04-messages.md)); this document defines how consumers find providers and establish connections.

## Transport requirements

Any transport used for SLOP must support:

1. **Bidirectional messaging** — both sides send messages
2. **Ordered delivery** — messages arrive in the order they were sent
3. **Framing** — message boundaries are preserved (not a raw byte stream)

Recommended transports:

| Transport | Best for | Notes |
|---|---|---|
| **Unix domain socket** | Local apps, daemons | Low latency, no network exposure |
| **WebSocket** | Web apps, remote | Standard, widely supported |
| **stdio** (stdin/stdout) | CLI tools, spawned processes | Simplest possible — newline-delimited JSON |
| **Named pipe** | Windows apps | Windows equivalent of Unix sockets |

### Stdio convention

For CLI tools and subprocess-based providers, SLOP uses **newline-delimited JSON** (NDJSON) on dedicated file descriptors:

- **fd 3** (provider → consumer): state snapshots, patches, events
- **fd 4** (consumer → provider): subscriptions, queries, invocations
- **stdout/stderr**: reserved for the app's normal output (not SLOP traffic)

If fd 3/4 are not available (e.g., simple pipes), fall back to:
- **stdout**: provider → consumer (one JSON object per line)
- **stdin**: consumer → provider (one JSON object per line)

### WebSocket convention

For WebSocket transports, each WebSocket message is one SLOP message (a JSON object). No additional framing needed.

The WebSocket endpoint should be at a well-known path: `ws://host:port/slop`

## Discovery

Discovery answers: *"What SLOP providers are available, and how do I connect to them?"*

### Local discovery

Providers register themselves by creating a descriptor file in a well-known directory:

```
~/.slop/providers/          # User-level providers
/tmp/slop/providers/        # Session-level providers (ephemeral)
```

Each provider writes a JSON file named `{app-id}.json`:

```jsonc
// ~/.slop/providers/vscode.json
{
  "id": "vscode",
  "name": "Visual Studio Code",
  "version": "1.95.0",
  "slop_version": "0.1",
  "transport": {
    "type": "unix",
    "path": "/tmp/slop/vscode.sock"
  },
  "pid": 12345,
  "capabilities": ["state", "patches", "affordances", "attention"],
  "description": "Code editor with workspace /home/user/my-project"
}
```

**Descriptor fields:**

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique identifier for this provider instance |
| `name` | yes | Human-readable name |
| `version` | no | App version |
| `slop_version` | yes | SLOP protocol version implemented |
| `transport` | yes | How to connect (see below) |
| `pid` | no | Process ID (for lifecycle management) |
| `capabilities` | yes | List of supported SLOP features |
| `description` | no | What this provider is / what it's doing |

**Transport descriptor variants:**

```jsonc
// Unix socket
{ "type": "unix", "path": "/tmp/slop/vscode.sock" }

// WebSocket
{ "type": "ws", "url": "ws://localhost:9222/slop" }

// Stdio (the consumer spawns the provider)
{ "type": "stdio", "command": ["my-tool", "--slop"] }

// Named pipe (Windows)
{ "type": "pipe", "name": "\\\\.\\pipe\\slop-vscode" }
```

### Lifecycle

- Providers create their descriptor file on startup and delete it on shutdown.
- If a provider crashes (descriptor exists but `pid` is dead), consumers should treat the descriptor as stale and may clean it up.
- Consumers can watch the discovery directory for changes (via `inotify`, `FSEvents`, `kqueue`) to detect new/removed providers.

### Network discovery (future)

For remote providers, mDNS/DNS-SD with service type `_slop._tcp` is reserved for future use. Not specified in v0.1.

## Connection lifecycle

```
Consumer                          Provider
   │                                  │
   │──── connect (transport) ────────>│
   │                                  │
   │<─── hello ───────────────────────│   Provider sends capabilities
   │                                  │
   │──── subscribe ──────────────────>│   Consumer requests state
   │                                  │
   │<─── snapshot ────────────────────│   Provider sends initial state
   │                                  │
   │<─── patch ───────────────────────│   Provider pushes changes
   │<─── patch ───────────────────────│
   │                                  │
   │──── invoke ─────────────────────>│   Consumer triggers action
   │<─── result ──────────────────────│
   │<─── patch ───────────────────────│   State updated from action
   │                                  │
   │──── disconnect ─────────────────>│
   │                                  │
```

### Hello message

After connection, the provider sends a `hello` message:

```jsonc
{
  "type": "hello",
  "provider": {
    "id": "vscode",
    "name": "Visual Studio Code",
    "slop_version": "0.1",
    "capabilities": ["state", "patches", "affordances", "attention"]
  }
}
```

The consumer may then send subscriptions, queries, or invocations. No handshake is required from the consumer — it simply starts sending requests.

## Capabilities

Capabilities declare which features a provider supports. Consumers must not rely on capabilities the provider hasn't declared.

| Capability | Meaning |
|---|---|
| `state` | Provider exposes a state tree (required) |
| `patches` | Provider sends incremental patches after snapshots |
| `affordances` | Nodes may include affordances |
| `attention` | Nodes may include salience/attention metadata |
| `windowing` | Collections support windowed queries |

`state` is the only required capability. Everything else is opt-in.

## Security considerations

- **Local transports** (Unix sockets, stdio) inherit filesystem permissions. Providers should set restrictive permissions on socket files (0600).
- **WebSocket transports** must require authentication for non-localhost connections. A bearer token in the initial HTTP upgrade request is the simplest approach.
- **Providers should not expose secrets** in the state tree. The state tree is a projection, not an internal dump — treat it like a public API surface.
- **Affordance invocations are untrusted input.** Providers must validate all parameters, just as they would for any API endpoint.
