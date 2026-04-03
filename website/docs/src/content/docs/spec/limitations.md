---
title: "Known Limitations & Future Work"
---
SLOP v0.1 is designed to be useful now while leaving room to grow. This page documents known limitations of the current protocol and SDK, and the work planned to address them.

## Protocol limitations

### No multi-user primitive

The protocol defines messages between one consumer and one provider on a single connection. It has no concept of sessions, user identity, or per-user state scoping.

This is intentional — session management is an application concern, and the protocol already supports multi-user through per-session provider instances or session-scoped tree rendering at the SDK level. But the SDKs don't implement this yet.

**Current behavior:** Server-side providers expose one shared state tree to all connected consumers. All consumers see the same data and the same affordances.

**Impact:** Production multi-user web apps can't use server-side SLOP providers correctly — all users would see the same state. Client-only SPAs are unaffected (each browser tab is its own provider).

**Path forward:** SDK-level session support — session-scoped descriptor functions, session-aware `refresh()`, and connection authentication helpers. See [Sessions & Multi-User](/sdk/sessions) for the full architecture. No protocol changes are needed.

### No backpressure signaling

The spec mentions `pause` / `resume` messages for subscriptions but doesn't define them. If a consumer is slow to process patches, the provider may skip intermediate versions and send a fresh snapshot — but there's no formal mechanism for the consumer to signal that it's falling behind.

**Current behavior:** Providers should coalesce rapid changes into fewer patches (debounce at 50-100ms). If a consumer can't keep up, behavior is implementation-defined.

**Impact:** High-frequency state changes (real-time dashboards, typing indicators) may overwhelm slow consumers. In practice, the debounce recommendation handles most cases.

**Path forward:** Define `pause` and `resume` message types in a future protocol version. Low priority — debouncing covers most real-world scenarios.

### No network discovery

Remote provider discovery via mDNS/DNS-SD (service type `_slop._tcp`) is reserved but not specified.

**Current behavior:** Local discovery works via `~/.slop/providers/` files and web discovery via `<meta>` tags and `/.well-known/slop`. Remote providers must be configured manually (hardcoded URLs).

**Impact:** AI agents can't automatically discover SLOP providers on the local network. Only matters for multi-machine setups.

**Path forward:** Specify mDNS/DNS-SD registration and browsing in a future protocol version. Depends on real-world demand for cross-machine discovery.

### No ancestor retention in salience filtering

When a consumer subscribes with `min_salience`, filtering is applied per-node. If a parent node falls below the threshold, its entire subtree is excluded — even if descendants have high salience.

**Current behavior:** Providers must ensure structurally important parent nodes carry salience at least as high as their most salient children.

**Impact:** Requires discipline from provider implementers. A notification buried three levels deep won't surface if its ancestors have low salience.

**Path forward:** A future protocol version may introduce an optional ancestor-retention mode where high-salience descendants automatically retain their ancestor chain.

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

**Workaround:** Create multiple `SlopServer` instances manually (one per session) and route WebSocket connections yourself. This works but doesn't scale well (see [Sessions & Multi-User](/sdk/sessions) for the tradeoffs).

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

### SDKs

- **Session-scoped trees** — the primary missing feature for production multi-user apps
- **Reconnection** — automatic reconnect with version-based catch-up
- **Typed results** — schema for affordance return values
- **Tree composition** — consumer-side merge of multiple provider trees
- **Persistence** — optional snapshot persistence for providers that restart (write last tree to disk, restore on startup)
