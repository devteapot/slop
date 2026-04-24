# Transport & Discovery

SLOP is transport-agnostic. The protocol defines message semantics (see [Messages](./messages.md)); this document defines how consumers find providers and establish connections.

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
| **postMessage** | In-browser SPAs, extensions | Browser-native IPC between page and extension contexts |
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

### postMessage convention

For in-browser communication between a page (SPA running a SLOP provider) and an extension (SLOP consumer), `window.postMessage` serves as the transport.

All SLOP messages are wrapped in a postMessage envelope:

```jsonc
// Page → Extension or Extension → Page
window.postMessage({
  slop: true,              // Identifies this as a SLOP message
  message: { ... }         // The SLOP message (subscribe, snapshot, patch, etc.)
}, targetOrigin);          // Must be an explicit origin, NOT "*"
```

The `slop: true` field distinguishes SLOP traffic from other postMessage usage on the page. Both sides filter on this field.

**Origin and source verification (REQUIRED).** `slop: true` is an in-band hint, not a security boundary — any script on the page can forge it. Implementations MUST:

- **Sender:** pass an explicit `targetOrigin` to `postMessage`. Never use `"*"` in production. Use the origin of the counterpart window (e.g. the expected extension bridge origin, or the page's own `window.location.origin` when the provider is same-origin).
- **Receiver:** on every `message` event, verify `event.origin` against an allowlist before inspecting `event.data`. If the handshake expects a specific window (e.g. a known iframe), also check `event.source` identity. Reject anything that fails either check without reading the payload.
- **Do not echo untrusted messages.** Relays/bridges MUST re-check origin on every hop; never forward messages whose origin was not verified on entry.

Using `"*"` as a targetOrigin leaks SLOP messages (which may contain invoke results, patches, or consumer intent) to any window that happens to be on the page, including third-party iframes. This is a privacy and integrity failure, not merely a best-practice violation.

**Connection handshake:**

1. Extension posts `{ slop: true, message: { type: "connect" } }` to the page
2. Page responds with the standard `hello` message
3. From here, the standard SLOP message flow applies — subscribe, snapshot, patch, invoke

This transport satisfies all three requirements: it is bidirectional, ordered (postMessage preserves order within a single origin), and framed (each postMessage is one discrete message).

**When to use postMessage vs WebSocket:**

- **postMessage** — the provider runs inside the browser (client-only SPAs, local-first apps). No server involved.
- **WebSocket** — the provider runs on a server. The browser connects to it. This is the common case for server-backed web apps.

Both speak the same SLOP protocol. The app's architecture determines which transport to use, not the protocol.

## Discovery

Discovery answers: *"What SLOP providers are available, and how do I connect to them?"*

### Local discovery

Providers register themselves by creating a descriptor file in a well-known directory:

```
~/.slop/providers/          # User-level providers
/tmp/slop/providers/        # Session-level providers (ephemeral)
```

**Filesystem hardening (REQUIRED).** These directories are shared across processes (especially `/tmp/slop/providers/` on multi-user systems), so descriptors and the directory itself are trust-sensitive:

- The directory MUST exist with mode `0700` and be owned by the current user. Consumers MUST refuse to scan a provider directory whose owner is not the current user, or whose mode grants group/other access.
- Descriptor files MUST be created with mode `0600`.
- Descriptors MUST be written atomically: write to a same-directory temp file (e.g. `{app-id}.json.tmp.{pid}`) and `rename(2)` into place. Never leave a partially written descriptor visible.
- Filenames MUST match `^[a-z0-9][a-z0-9._-]{0,63}\.json$`. Consumers MUST ignore files whose names do not match, and MUST NOT treat any segment of the filename as a path (no `/`, no `..`).
- On read, consumers MUST re-verify owner and mode after `open()` (e.g. `fstat`) and ignore descriptors that fail either check. This closes TOCTOU races if a non-conforming file appears mid-scan.

On Windows, which lacks POSIX modes, consumers MUST use the per-user `%LOCALAPPDATA%\slop\providers\` location and rely on the ACL inherited from that directory; a world-writable fallback is NOT acceptable.

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

// postMessage (in-browser SPA)
{ "type": "postmessage" }
```

### Lifecycle

- Providers create their descriptor file on startup and delete it on shutdown.
- If a provider crashes (descriptor exists but `pid` is dead), consumers should treat the descriptor as stale and may clean it up.
- Consumers can watch the discovery directory for changes (via `inotify`, `FSEvents`, `kqueue`) to detect new/removed providers.

### Web discovery

Web apps declare SLOP support through two complementary mechanisms:

**HTML meta tag** — instant discovery for extensions scanning the page:

```html
<meta name="slop" content="ws://localhost:3737/slop">
```

For in-browser providers using postMessage:

```html
<meta name="slop" content="postmessage">
```

**Well-known URL** — machine-discoverable, follows [RFC 8615](https://datatracker.ietf.org/doc/html/rfc8615):

```
GET /.well-known/slop
```

Response:

```jsonc
{
  "id": "kanban",
  "name": "Kanban Board",
  "slop_version": "0.1",
  "transport": {
    "type": "ws",
    "url": "ws://localhost:3737/slop"
  },
  "capabilities": ["state", "patches", "affordances"]
}
```

This is the same descriptor format used in local discovery. The only difference is the delivery mechanism — HTTP instead of a filesystem read.

Apps should implement both: the meta tag costs one line of HTML, the well-known URL is a single endpoint. Extensions check the meta tag first (no extra request), then fall back to probing `/.well-known/slop`.

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
| `async` | Provider may return `accepted` status on invoke results |
| `content_refs` | Nodes may include `content_ref` fields |

`state` is the only required capability. Everything else is opt-in.

## Security considerations

- **Local transports** (Unix sockets, stdio) inherit filesystem permissions. Providers MUST set socket file mode to `0600` and MUST NOT place sockets in world-writable directories. Provider descriptor files and their enclosing directory are subject to the hardening rules in [Local discovery](#local-discovery) (owner check, `0700`/`0600`, atomic rename, filename allowlist).
- **WebSocket transports** must require authentication for non-localhost connections. A bearer token in the initial HTTP upgrade request is the simplest approach.
- **postMessage transports** MUST NOT use `"*"` as a `targetOrigin` and MUST verify `event.origin` on every received message. See [postMessage convention](#postmessage-convention).
- **Providers should not expose secrets** in the state tree. The state tree is a projection, not an internal dump — treat it like a public API surface.
- **Affordance invocations are untrusted input.** Providers must validate all parameters, just as they would for any API endpoint.
- **Prompt injection is in scope.** A consumer may send fabricated, stale, or policy-violating `invoke` messages regardless of what the tree previously showed. Providers must re-authorize every invoke against live state, caller identity, and resource policy.
- **Bridges and relays are not the security boundary.** Browser extensions, desktop daemons, MCP proxies, and service workers may discover providers or relay SLOP messages, but the provider (or authoritative backend behind it) must make the final allow/deny decision for every action.
- **Multi-user servers** must use session-scoped state so that each user's state tree is isolated. Authentication happens at the transport level (WebSocket upgrade), not in SLOP messages. See [Sessions & Multi-User](../../docs/sdk/sessions.md) for SDK implementation patterns.
