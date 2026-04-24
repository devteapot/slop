# SEP-0000: SLOP over MCP

- **Status**: Idea (pre-sponsor)
- **Type**: Standards Track
- **Created**: 2026-04-24
- **Author(s)**: SLOP maintainers (contact: https://slopai.dev)
- **Issue**: TBD

> This SEP is a work-in-progress draft maintained in the SLOP repository under `seps/`. It has not yet been submitted to the MCP `seps/` directory and has no assigned SEP number.

## Abstract

This SEP defines `experimental/slop`, an optional MCP extension that lets an MCP server expose a live, semantic state tree to an MCP client. It adds three methods — `slop/subscribe`, `slop/unsubscribe`, `slop/invoke` — and three server-to-client notifications — `notifications/slop/snapshot`, `notifications/slop/patch`, `notifications/slop/attention` — carried over the existing Streamable HTTP and stdio transports.

The extension reuses MCP's initialization handshake, transport, and session semantics unchanged. It is strictly additive: a server that does not declare `experimental/slop` rejects `slop/*` methods with a standard JSON-RPC "method not found" error, and a client that is not extension-aware simply never calls them. Continued interoperation over the core protocol is unaffected in either direction.

SLOP is an existing open protocol for AI state observation ([spec](https://github.com/devteapot/slop/tree/main/spec)). This SEP defines how a SLOP provider's wire semantics can be carried by MCP so that existing MCP clients can subscribe to SLOP state without a separate transport.

## Motivation

MCP today models two primary interactions between a client and a server: **tool invocation** and **resource retrieval**. Both are pull-shaped: the client decides when to call a tool or read a resource. The `resources/subscribe` primitive exists, but it signals only that a resource *changed* — the client must re-read the resource, and the resource shape is not defined for live application state.

This leaves an underserved case: an AI host that needs to **observe what an application currently is** — its open views, selected items, pending work, error states — and receive incremental updates as those change, without polling and without a dedicated tool per observable.

Today this is handled either by:

1. **One tool per observable.** Does not scale; a rich application needs hundreds of read-only tools to reconstruct state, and the model must call every one to see anything.
2. **Screenshot + vision.** Expensive, lossy, fragile, and loses the semantic information the application already has.
3. **Custom transports outside MCP.** Fragments tooling; every MCP host must learn a new wire.

SLOP solves this problem with a state tree and JSON Patch-style subscription model, plus contextual affordances living on nodes rather than in a global registry. But SLOP today requires hosts to adopt a new transport. Carrying SLOP over MCP — as an optional extension — lets MCP clients reach SLOP providers over a transport and session model they already implement, and lets SLOP providers interoperate with MCP hosts without publishing a second, parallel transport. Clients still need extension-aware code to speak `slop/*`; this SEP removes the transport divergence, not the client-side implementation work.

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
        "attention": true,
        "async": false
      }
    }
  }
}
```

Sub-flags correspond to SLOP capabilities (see [SLOP transport spec, §Capabilities](https://github.com/devteapot/slop/blob/main/spec/core/transport.md)). `version` is the SLOP protocol version the server implements. `async` indicates whether the server supports `accepted` results on `slop/invoke` (see §2.3).

Negotiation is **server-declared, client-initiated**:

- A server MUST declare `experimental/slop` to accept any `slop/*` request or emit any `notifications/slop/*`.
- A client MAY declare `experimental/slop` for symmetry and introspection, but the server does not gate behavior on it. A server MUST NOT emit `notifications/slop/*` unless the client has opened at least one active subscription via `slop/subscribe` — which is itself the client's opt-in signal.
- A client that did not declare `experimental/slop` and does not call `slop/subscribe` will never see `slop/*` traffic; a server that did not declare it will reject `slop/*` requests with JSON-RPC error `-32601` (Method not found).

This resolves the apparent tension between "client declaration is informational" and "clients that do not declare the capability never see traffic": subscription state, not capability declaration, is what gates server-to-client notifications.

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
  "path": "/inbox/messages/42",    // target node path (SLOP path syntax)
  "affordance": "reply",            // affordance name on that node
  "observedVersion": 42,            // optional: subscription version the client saw
  "subscriptionId": "string",       // optional: subscription the client observed from
  "params": { /* ... */ }           // affordance-defined parameters
}
```

When `observedVersion` and `subscriptionId` are provided together, the server MAY reject the invocation with `error.code = "conflict"` if the affordance is no longer valid at the current server version. Clients SHOULD include them whenever they invoke an affordance they learned about through a subscription — it lets the server give a precise denial reason instead of a generic error.

**Result (success or business outcome):**

```jsonc
{
  "status": "ok" | "accepted",
  "data": { /* ... */ }
}
```

**Result (business error — affordance-level failure):**

```jsonc
{
  "status": "error",
  "error": {
    "code": "unauthorized" | "conflict" | "invalid" | "internal",
    "message": "..."
  }
}
```

Servers supporting the `async` sub-capability MAY return `{ "status": "accepted" }` and continue delivering progress via `notifications/slop/patch` on the affected subtree. Servers that do not declare `async: true` MUST NOT return `accepted`.

### Error model

This SEP uses a two-layer error model:

- **Protocol-layer failures** (unknown method, malformed params, schema violation, unknown `subscriptionId`, missing required capability) are returned as standard [JSON-RPC errors](https://www.jsonrpc.org/specification#error_object) in the response's `error` field. Use existing JSON-RPC codes: `-32601` (Method not found), `-32602` (Invalid params), and the reserved server error range for extension-specific protocol errors.
- **Business-layer failures** on `slop/invoke` (the affordance exists but cannot currently be executed: not authorized, stale version, invalid input, internal failure) are returned as a successful JSON-RPC response whose `result` carries `status: "error"` and a SLOP-native `error` object. This mirrors SLOP's existing `result` message shape and keeps re-authorization denials distinguishable from protocol errors.

A `conflict` business error indicates that the affordance was valid at `observedVersion` but is not valid at the current server version — this is the re-authorization path mandated by §Security Implications.

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

Incremental change carrying SLOP patch operations. Operation semantics (`add`, `remove`, `replace`) follow [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902); paths use **SLOP path syntax** (node-ID segments with reserved field keywords `properties`, `children`, `affordances`, `meta`, `content_ref`), not RFC 6901 JSON Pointer. See [SLOP messages.md §Patch path syntax](https://github.com/devteapot/slop/blob/main/spec/core/messages.md#patch-path-syntax) for the normative definition. SLOP paths are stable across sibling reordering, which RFC 6901 array-index paths are not.

```jsonc
{
  "subscriptionId": "string",
  "fromVersion": 42,
  "toVersion": 43,
  "ops": [
    { "op": "replace", "path": "/inbox/msg-42/properties/unread", "value": false }
  ]
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

**Streamable HTTP requirements.** The core Streamable HTTP spec makes server-to-client SSE optional — a compliant MCP server MAY return `405 Method Not Allowed` for the GET that opens the server→client stream. Long-lived SLOP subscriptions cannot work without that stream. Therefore:

- A server that declares `experimental/slop` over Streamable HTTP MUST support server-initiated SSE on the GET endpoint defined by the Streamable HTTP spec. Returning `405` on GET while advertising `experimental/slop` is a conformance violation.
- A server MUST deliver `notifications/slop/snapshot`, `notifications/slop/patch`, and `notifications/slop/attention` on that SSE stream.
- A client over Streamable HTTP MUST establish the GET SSE stream before issuing its first `slop/subscribe`. A server that receives `slop/subscribe` from a client without an active GET SSE stream MUST reject it with JSON-RPC error `-32002` ("SSE stream required") and MUST NOT queue notifications for a future stream. This keeps the subscription lifecycle coupled to the stream lifecycle and avoids unbounded server-side buffers.
- A server SHOULD set SSE event IDs on every notification it emits so clients can use `Last-Event-ID` for redelivery if the core transport supports it. Event-ID-based resumption is best-effort: clients MUST NOT assume redelivery and MUST be prepared to reissue `slop/subscribe` on reconnect.

**Reconnection and subscription state.** A client that reconnects (new `MCP-Session-Id`, or same session after SSE drop without successful `Last-Event-ID` replay) MUST reissue `slop/subscribe` for subscriptions it wants to resume. Servers are not required to retain subscription state across MCP sessions by default; see Open Questions for an opt-in persistence path.

**stdio.** No changes — notifications and requests are framed per the core stdio transport spec. All requirements in this section other than the SSE/GET requirement apply trivially.

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

- Clients that are not extension-aware never call `slop/*` methods and therefore never receive `notifications/slop/*` (see §1 for why subscription state, not capability declaration, is the gate). A server MUST NOT push `slop/*` notifications to a client that has no active subscription.
- Servers that do not declare `experimental/slop` reject `slop/*` requests with JSON-RPC `-32601` (Method not found). Clients MUST treat this as "extension unsupported" and fall back.
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

## Resolved Design Questions

Positions taken in this draft, ahead of sponsor review:

### Discovery is dual-publish, not combined

A server that supports both protocols publishes `/.well-known/mcp` (once the MCP server-cards SEP lands) **and** `/.well-known/slop` side-by-side. This SEP does not define a combined descriptor.

Rationale: discovery scope is separable from the wire. Coupling this SEP to the server-cards SEP doubles the review surface and presumes that SLOP is "discovered through MCP," which is a design call the community should make in its own SEP. A future co-authored SEP MAY define a combined hint without blocking this one.

Tradeoff accepted: two round-trips for naive crawlers; missing explicit "this server does both" signal (inferred from same-origin co-location).

### Patch format is SLOP-native, not pure RFC 6902

Patches carry RFC 6902 **operation semantics** (`add` / `remove` / `replace`) with **SLOP path syntax** (node-ID segments, reserved field keywords). The SLOP spec is referenced normatively.

Rationale: SLOP's node-ID path syntax is load-bearing — it keeps paths stable across sibling reordering, which RFC 6901 JSON Pointer does not. Rewriting to RFC 6901 would either fork SLOP or force a spec change in SLOP itself, neither of which is in scope for an extension SEP. A brand-new SLOP-native delta format is rejected as premature: the only divergence from off-the-shelf JSON Patch is the path grammar, and that already has a tested answer.

Tradeoff accepted: off-the-shelf JSON Patch libraries do not work directly on SLOP paths; conformance tests must use SLOP SDK primitives.

### Affordance invocation is a distinct method, not `tools/call`

`slop/invoke` is its own JSON-RPC method carrying `{ path, affordance, params }` and optional `{ observedVersion, subscriptionId }`. Affordances are NOT exposed as MCP tools by this SEP.

Rationale: affordances are contextual to a node at a version — "reply on message msg-42" is only meaningful because the subscribed tree showed that node as replyable. Folding into `tools/call` either flattens affordances into global tools (the MCP failure mode SLOP was built to solve) or encodes node context into tool names and churns the tool list at state-change frequency, which MCP's `tools/list_changed` notification was not designed for.

Servers MAY still mirror top-level affordances as stable MCP tools for hosts that do not speak `experimental/slop`. That is a server implementation choice, not a protocol requirement.

Tradeoff accepted: hosts cannot reuse their existing `tools/call` dispatch and consent UI verbatim; they need an extension-aware path for invocations.

## Open Questions for Sponsor Review

1. **Subscription lifetime across reconnects.** The draft says servers are not required to retain subscription state across MCP sessions; clients re-subscribe after reconnect. Should there be an opt-in mechanism — e.g. a server-declared `persistent: true` sub-capability — for session-persistent subscriptions keyed by `MCP-Session-Id`?
2. **Extension versioning cadence.** Does the `version` field in the capability track the upstream SLOP spec version lock-step, or does the extension version independently?
3. **Promotion criteria.** What specifically moves this from `experimental/slop` to a non-experimental capability — one reference implementation, two independent implementations, production deployment, or a defined soak window?
4. **Relationship to MCP Tasks.** MCP's experimental Tasks primitive ([SEP-1686](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1686)) covers long-running tool invocations with retry/expiry semantics. This draft deliberately keeps async affordance invocation SLOP-native (`accepted` + patches on the affected subtree) so that SLOP providers do not need to grow Tasks-awareness. Should a future revision add an opt-in bridge where `slop/invoke` that returns `accepted` is *also* surfaced as an MCP task, for hosts that already render task progress? Current position: out of scope for the initial SEP.
