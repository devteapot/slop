# SEP-0000: SLOP over MCP

- **Status**: Idea (pre-sponsor)
- **Type**: Standards Track
- **Created**: 2026-04-24
- **Author(s)**: SLOP maintainers (contact: https://slopai.dev)
- **Issue**: TBD

> This SEP is a work-in-progress draft maintained in the SLOP repository under `seps/`. It has not yet been submitted to the MCP `seps/` directory and has no assigned SEP number.

## Abstract

This SEP defines `experimental/slop`, an optional MCP extension that lets an MCP server expose a live, semantic state tree to an MCP client. It adds three methods — `slop/subscribe`, `slop/unsubscribe`, `slop/invoke` — and three server-to-client notifications — `notifications/slop/snapshot`, `notifications/slop/patch`, `notifications/slop/attention` — carried over the existing Streamable HTTP and stdio transports.

The extension reuses MCP's initialization handshake, transport, and session semantics unchanged. It is strictly additive: clients and servers that do not declare `experimental/slop` negotiate it away during initialization and continue to interoperate over the core protocol.

SLOP is an existing open protocol for AI state observation ([spec](https://github.com/devteapot/slop/tree/main/spec)). This SEP defines how a SLOP provider's wire semantics can be carried by MCP so that existing MCP clients can subscribe to SLOP state without a separate transport.

## Motivation

MCP today models two primary interactions between a client and a server: **tool invocation** and **resource retrieval**. Both are pull-shaped: the client decides when to call a tool or read a resource. The `resources/subscribe` primitive exists, but it signals only that a resource *changed* — the client must re-read the resource, and the resource shape is not defined for live application state.

This leaves an underserved case: an AI host that needs to **observe what an application currently is** — its open views, selected items, pending work, error states — and receive incremental updates as those change, without polling and without a dedicated tool per observable.

Today this is handled either by:

1. **One tool per observable.** Does not scale; a rich application needs hundreds of read-only tools to reconstruct state, and the model must call every one to see anything.
2. **Screenshot + vision.** Expensive, lossy, fragile, and loses the semantic information the application already has.
3. **Custom transports outside MCP.** Fragments tooling; every MCP host must learn a new wire.

SLOP solves this problem with a state tree + JSON Patch subscription model, plus contextual affordances living on nodes rather than in a global registry. But SLOP today requires hosts to adopt a new transport. Carrying SLOP over MCP — as an optional extension — lets every existing MCP host consume SLOP without changing clients, and lets every SLOP provider reach those hosts without re-implementing MCP's tool and resource surfaces.

This SEP is deliberately scoped to the **wire adaptation**. The semantic model (state tree, patch format, affordance shape, salience, attention) is defined by the SLOP specification and is referenced here normatively.

## Specification

### 1. Capability declaration

A server that supports this extension MUST declare the capability during initialization:

```jsonc
{
  "capabilities": {
    "experimental": {
      "slop": {
        "version": "0.1",
        "subscribe": true,
        "affordances": true,
        "attention": true
      }
    }
  }
}
```

Sub-flags correspond to SLOP capabilities (see [SLOP transport spec, §Capabilities](https://github.com/devteapot/slop/blob/main/spec/core/transport.md)). `version` is the SLOP protocol version the server implements.

A client that supports this extension MAY declare the capability; declaration is informational only — servers do not gate behavior on it beyond noting that the peer understands SLOP semantics.

Servers and clients that do not declare the capability MUST ignore `slop/*` methods and notifications per the standard MCP extension rules.

### 2. Methods

#### 2.1 `slop/subscribe`

Open a subscription to a subtree of the server's SLOP state tree.

**Parameters:**

```jsonc
{
  "subscriptionId": "string",      // client-generated, opaque
  "path": "/",                      // SLOP node path, defaults to root
  "depth": -1,                      // SLOP depth semantics: 0, N, or -1 (unlimited)
  "minSalience": 0.0,               // optional salience threshold
  "filters": { /* ... */ }          // optional, forward-compatible
}
```

**Result:** empty on success. The server MUST immediately follow the result with a `notifications/slop/snapshot` carrying `subscriptionId` and the initial tree (or a snapshot error).

#### 2.2 `slop/unsubscribe`

Close a subscription.

**Parameters:** `{ "subscriptionId": "string" }`

**Result:** empty.

#### 2.3 `slop/invoke`

Invoke an affordance on a node. Semantics match the SLOP `invoke` message.

**Parameters:**

```jsonc
{
  "path": "/inbox/messages/42",    // target node path
  "affordance": "reply",            // affordance name on that node
  "params": { /* ... */ }           // affordance-defined parameters
}
```

**Result:**

```jsonc
{
  "status": "ok" | "accepted" | "error",
  "data": { /* ... */ },
  "error": { "code": "unauthorized" | "conflict" | "invalid" | "internal", "message": "..." }
}
```

Servers supporting the `async` sub-capability MAY return `accepted` and continue delivering progress via `notifications/slop/patch` on the affected subtree.

### 3. Notifications

All three notifications carry `subscriptionId` so a client can multiplex multiple subscriptions over one MCP session.

#### 3.1 `notifications/slop/snapshot`

Initial state, or a re-synchronization snapshot after a missed patch sequence.

```jsonc
{
  "subscriptionId": "string",
  "version": 42,                    // monotonic per subscription
  "tree": { /* SLOP node */ },
  "subscriptionInfo": {             // optional, what was actually served
    "depth": 3,
    "minSalienceApplied": 0.2
  }
}
```

#### 3.2 `notifications/slop/patch`

Incremental change as JSON Patch (RFC 6902), with SLOP version continuity.

```jsonc
{
  "subscriptionId": "string",
  "fromVersion": 42,
  "toVersion": 43,
  "ops": [ /* JSON Patch ops */ ]
}
```

If a client detects a version gap, it MUST send `slop/subscribe` again with the same `subscriptionId` to trigger a fresh snapshot. Servers MAY send an unsolicited `notifications/slop/snapshot` to recover.

#### 3.3 `notifications/slop/attention`

Salience / focus hint. Non-structural; does not affect the tree itself.

```jsonc
{
  "subscriptionId": "string",
  "focus": "/inbox/messages/42",
  "reason": "user_interaction" | "new_event" | "error"
}
```

### 4. Transport

This SEP adds no new transport. Methods and notifications ride MCP's Streamable HTTP and stdio transports exactly as defined in the core specification.

On Streamable HTTP, snapshot and patch notifications are delivered on the server-to-client SSE stream established by the session. Standard `MCP-Session-Id` and `Last-Event-ID` semantics apply for reconnection. A client that reconnects MUST reissue `slop/subscribe` for subscriptions it wants to resume; servers are not required to retain subscription state across sessions.

### 5. Relationship to MCP resources and tools

- MCP `resources/*` and SLOP subscriptions are **complementary, not alternative**. A server MAY expose selected SLOP content-reference targets as MCP resources for hosts that cite documents by URI.
- MCP `tools/*` and SLOP affordances are **not interchangeable**. Affordances are contextual to tree nodes; tools are global. A server MAY mirror SLOP affordances as MCP tools for clients that do not speak this extension, but such tools MUST re-validate against live state on invocation (see §Security).

## Rationale

### Why not extend `resources/subscribe`?

`resources/subscribe` notifies that a resource changed; the client must re-read the resource to see what changed. That round trip is acceptable for documents but prohibitive for live, high-frequency state (tens of updates per second during active work). A native patch stream with version continuity avoids the re-read and preserves incremental semantics through JSON Patch.

Additionally, MCP resources have no concept of depth, salience, or contextual affordances. Bolting those onto the resource primitive would either mutate the resource model or bury them in `_meta`. A distinct method namespace keeps the resource primitive clean and lets SLOP evolve independently.

### Why `experimental/slop` instead of a core capability?

This SEP reuses an existing, stable external specification (SLOP) and introduces new wire shapes that have not yet been exercised by MCP clients at scale. `experimental/` is the conventional prefix for opt-in extensions that may evolve during incubation. Promotion to a non-experimental name would happen in a follow-up SEP once the reference implementation and at least one independent client implementation are in production.

### Why carry JSON Patch and salience instead of redesigning the wire?

JSON Patch (RFC 6902) is already an IETF standard with broad library support. Salience, focus, and affordance validity are load-bearing in SLOP — rewriting them as part of this SEP would duplicate a specification that already has consumers and would leak SLOP design debates into the MCP SEP process. The adaptation layer is intentionally thin.

### Why three notifications instead of one?

Snapshots, patches, and attention cues have different cost and caching profiles. Keeping them separate lets clients subscribe to attention-only updates without paying for the full patch stream, and lets servers emit attention updates at higher frequency than structural patches.

## Backward Compatibility

This SEP is fully backward compatible with the core MCP specification.

- Clients that do not declare `experimental/slop` never see `slop/*` traffic.
- Servers that do not declare `experimental/slop` never receive `slop/*` requests.
- Servers MAY support this extension and `tools/*` / `resources/*` simultaneously; clients choose which surface to use based on negotiated capabilities.
- The wire additions do not reuse any method name or notification prefix already defined by the core specification.

Promotion from `experimental/slop` to a non-experimental capability in a future SEP would be a breaking change only for implementations that hard-coded the experimental name without capability negotiation. The SEP process for promotion will specify a transition window during which both names are recognized.

## Reference Implementation

Required before promotion to `Accepted`. Planned deliverables:

1. **Server** — `@slop-ai/mcp-server` package exposing any `@slop-ai/core` provider as an MCP server speaking `experimental/slop`. Built on `@modelcontextprotocol/sdk`.
2. **Client** — `@slop-ai/mcp-client` package consuming a `experimental/slop`-capable server into a standard SLOP consumer surface.
3. **Conformance tests** — shared test suite validating `slop/subscribe`, patch sequencing, reconnection, affordance invocation error codes, and capability negotiation.
4. **Host integration** — one end-to-end demo against at least one existing MCP host (Claude Code, or VS Code MCP client) using the SDK reference implementation.

The prototype will live in the SLOP repository under `packages/typescript/integrations/mcp/` and will be linked from this SEP before formal review.

## Security Implications

The security model mirrors SLOP's existing transport security (see [transport.md, §Security considerations](https://github.com/devteapot/slop/blob/main/spec/core/transport.md)):

- **Bridges and relays are not the security boundary.** MCP hosts carrying `slop/*` traffic MAY mediate user consent and iframe sandboxing (if also using MCP Apps), but the SLOP provider (or the authoritative backend behind it) MUST re-authorize every `slop/invoke` against live state and caller identity.
- **State projection, not state dump.** Servers MUST treat the subscribed tree as a public API surface; secrets, credentials, and PII that should not be visible to the host model MUST NOT appear in the tree.
- **Affordance re-validation.** `slop/invoke` parameters are untrusted input. Servers MUST validate against the affordance's declared parameters and the current state of the target node; an affordance that was exposed at subscribe time MAY be invalid at invoke time, and servers MUST return `error.code = "conflict"` in that case rather than executing.
- **Session scoping.** Multi-user servers MUST use session-scoped trees so that each authenticated caller receives only their own state. The MCP `MCP-Session-Id` binds the transport session; SLOP's session scoping rides on that binding.
- **Salience is a hint, not a gate.** A server MUST NOT rely on `minSalience` as a security filter — it is a bandwidth/attention optimization, not an access control mechanism.
- **Resource exposure through content references.** If a server exposes SLOP `content_ref` targets as MCP resources, it MUST apply the same authorization rules to the resource read path as it applies to `slop/subscribe` for the owning node.

## Open Questions

1. Should this SEP also define a `.well-known` discovery hint for servers that speak both MCP and SLOP natively, or is dual-publish of `/.well-known/mcp` and `/.well-known/slop` sufficient? (Leaning toward the latter — discovery belongs in the server-cards SEP, not here.)
2. Is JSON Patch the right delta format given MCP's wider `jsonrpc` style, or should this SEP define a lighter SLOP-native delta? (Current position: JSON Patch is the right default; rewrite would be premature.)
3. Should `slop/invoke` be delivered as a distinct method or folded into `tools/call` with a reserved tool name? (Current position: distinct method — folding loses affordance node context.)

These are noted for the sponsor conversation; they are not blockers for the draft.
