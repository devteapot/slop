# Known Limitations & Future Work

SLOP v0.1 is designed to be useful now while leaving room to grow. This page documents known limitations of the current protocol and SDK, and the work planned to address them.

## Protocol limitations

### No multi-user primitive

The protocol defines messages between one consumer and one provider on a single connection. It has no concept of sessions, user identity, or per-user state scoping.

This is intentional — session management is an application concern, and the protocol already supports multi-user through per-session provider instances or session-scoped tree rendering at the SDK level. But the SDKs don't implement this yet.

**Current behavior:** Server-side providers expose one shared state tree to all connected consumers. All consumers see the same data and the same affordances.

**Impact:** Production multi-user web apps can't use server-side SLOP providers correctly — all users would see the same state. Client-only SPAs are unaffected (each browser tab is its own provider).

**Path forward:** SDK-level session support — session-scoped descriptor functions, session-aware `refresh()`, and connection authentication helpers. See [Sessions & Multi-User](../docs/sdk/sessions.md) for the full architecture. No protocol changes are needed.

### No standardized authorization metadata

The protocol models **what actions are exposed right now**, but it does not standardize a machine-readable policy layer explaining *why* an action is allowed, what permission it requires, or which constraints are advisory versus hard enforcement.

**Current behavior:** Providers expose contextual affordances, `dangerous` hints, and parameter schemas. At execution time they may reject an invoke with `unauthorized` or `conflict`, but the exact policy logic and denial semantics are implementation-specific.

**Impact:** Consumers can see the safe path more clearly, but they cannot reliably explain permission boundaries, compare security posture across providers, or reason about denial causes beyond the coarse runtime error codes.

**Path forward:** A future extension could define optional affordance policy metadata — for example required capability tags, structured denial reasons, or policy scopes — while keeping runtime enforcement authoritative at the provider.

### No backpressure signaling

The spec mentions `pause` / `resume` messages for subscriptions but doesn't define them. If a consumer is slow to process patches, the provider may skip intermediate versions and send a fresh snapshot — but there's no formal mechanism for the consumer to signal that it's falling behind.

**Current behavior:** Providers should coalesce rapid changes into fewer patches (debounce at 50-100ms). If a consumer can't keep up, behavior is implementation-defined.

**Impact:** High-frequency state changes (real-time dashboards, typing indicators) may overwhelm slow consumers. In practice, the debounce recommendation handles most cases.

**Path forward:** Define `pause` and `resume` message types in a future protocol version. Low priority — debouncing covers most real-world scenarios.

### No LAN discovery

Remote provider discovery via mDNS/DNS-SD (service type `_slop._tcp`) is reserved but not specified.

**Current behavior:** Local discovery works via `~/.slop/providers/` files and web discovery via `<meta>` tags and `/.well-known/slop`. Remote providers must still be configured manually (hardcoded URLs).

**Impact:** AI agents can't automatically discover SLOP providers on the local network. Only matters for multi-machine setups.

**Path forward:** Specify mDNS/DNS-SD registration and browsing in a future protocol version. Depends on real-world demand for cross-machine discovery.

### No ancestor retention in salience filtering

When a consumer subscribes with `min_salience`, filtering is applied per-node. If a parent node falls below the threshold, its entire subtree is excluded — even if descendants have high salience.

**Current behavior:** Providers must ensure structurally important parent nodes carry salience at least as high as their most salient children.

**Impact:** Requires discipline from provider implementers. A notification buried three levels deep won't surface if its ancestors have low salience.

**Path forward:** A future protocol version may introduce an optional ancestor-retention mode where high-salience descendants automatically retain their ancestor chain.

### No formal MCP extension

SLOP interoperates with MCP today through out-of-band mechanisms: an MCP proxy that translates tool calls into affordance invocations, an MCP Apps bridge that runs a SLOP session inside a sandboxed iframe, and read-only `search` / `fetch` facades for research-oriented MCP hosts (see [MCP Interoperability](./integrations/mcp.md)). None of these is specified as an MCP extension.

**Current behavior:** SLOP is not discoverable as a formal MCP capability during MCP initialization. A host that only speaks MCP cannot subscribe to SLOP snapshots and patches without a bridge adapter.

**Impact:** SLOP providers must ship a bridge to be usable inside MCP-only hosts. Registry-level discovery across both protocols currently requires publishing the SLOP `/.well-known/slop` descriptor plus whatever MCP registry or server metadata the target MCP host expects.

**Path forward:** Register a "SLOP over MCP" extension (SEP) once MCP's event-driven update, metadata, and session-scaling work stabilizes (tracked in the [MCP 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)). The extension would reserve an `experimental/slop` capability plus `slop/subscribe` / `slop/unsubscribe` / `slop/invoke` methods and snapshot / patch / attention notifications, letting MCP clients enter a SLOP session without leaving the MCP transport. A working draft lives at [`seps/0000-slop-over-mcp.md`](https://github.com/devteapot/slop/blob/main/seps/0000-slop-over-mcp.md) in the SLOP repository; it is pre-sponsor and not yet submitted to the MCP SEP directory.

### No binary transport

All SLOP messages are JSON. There's no binary encoding option for scenarios where message size or parse overhead matters.

**Current behavior:** JSON everywhere. For most AI use cases (text-heavy state trees, moderate update frequency), this is fine.

**Impact:** High-frequency providers (gaming, real-time collaboration) may find JSON parsing overhead significant.

**Path forward:** An optional binary encoding (MessagePack, CBOR, or Protocol Buffers) could be specified as an alternative wire format. The message semantics would stay identical. Low priority — JSON is the right default for an AI-focused protocol.

### No subscription negotiation

When a consumer subscribes, the provider must accept it as-is. There's no mechanism for the provider to say "I can't serve depth -1, here's depth 3 instead" or "I don't support that filter."

**Current behavior:** Providers silently do their best — they may return shallower trees than requested or ignore unsupported filters.

**Impact:** Consumers can't tell whether they got exactly what they asked for or a provider-constrained subset.

**Path forward:** An optional `subscription_info` field on snapshot responses indicating what was actually served versus what was requested.

## SDK limitations

### No session-scoped trees

The `@slop-ai/server` and `slop-ai` (Python) SDKs create a single provider instance with a single state tree. There's no built-in way to render different trees per consumer based on user identity.

**Workaround:** Create multiple `SlopServer` instances manually (one per session) and route WebSocket connections yourself. This works but doesn't scale well (see [Sessions & Multi-User](../docs/sdk/sessions.md) for the tradeoffs).

**Path forward:** Add session-aware descriptor functions `(session) => descriptor` and scoped refresh `refresh({ where: ... })` to the core engine.

### No typed affordance responses

Affordance handlers return untyped data. The `result` message has a generic `data` field with no schema describing what the handler returns.

**Current behavior:** Consumers must infer the structure of result data from context or documentation.

**Path forward:** An optional `returns` schema on affordance definitions, mirroring the `params` schema for inputs.

### No offline / reconnection handling

The SDKs don't handle reconnection after a dropped WebSocket connection. If the connection drops, the consumer loses its subscriptions and must re-subscribe manually.

**Current behavior:** Connection drops are terminal. The consumer must establish a new connection and re-subscribe.

**Path forward:** Automatic reconnection with subscription replay and version-based catch-up (the consumer sends its last known version, the provider sends patches since then or a fresh snapshot if the gap is too large).

### No tree composition across providers

When a consumer connects to multiple providers (e.g., a mail app and a calendar app), it receives separate trees. There's no built-in way to compose them into a single unified tree for the LLM.

**Current behavior:** The consumer SDK (`@slop-ai/consumer`) presents each provider's tree separately. The LLM prompt must include multiple trees.

**Path forward:** A consumer-side tree merge utility that combines multiple provider trees under a virtual root. The desktop app and extension already do a version of this for display — it could be formalized in the consumer SDK.

## Future work

### Protocol

- **Backpressure** (`pause` / `resume`) — formal flow control for subscriptions
- **Network discovery** (mDNS/DNS-SD) — automatic provider discovery on local networks
- **Ancestor retention** — optional mode for salience filtering that preserves ancestor chains
- **Subscription negotiation** — providers can report what they actually served
- **Binary encoding** — optional MessagePack/CBOR wire format
- **MCP extension (SEP)** — register SLOP as a formal MCP capability once MCP's event-driven update, metadata, and session-scaling work stabilizes

### SDKs

- **Session-scoped trees** — the primary missing feature for production multi-user apps
- **Reconnection** — automatic reconnect with version-based catch-up
- **Typed results** — schema for affordance return values
- **Tree composition** — consumer-side merge of multiple provider trees
- **Persistence** — optional snapshot persistence for providers that restart (write last tree to disk, restore on startup)
