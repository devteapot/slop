---
title: "Message Protocol"
---
All SLOP communication consists of JSON messages exchanged between a consumer and a provider. Messages are categorized by direction.

## Message envelope

Every message has a `type` field and optionally an `id` for request-response correlation:

```jsonc
{
  "type": "subscribe",       // Message type (required)
  "id": "req-1",             // Request ID (optional, for correlation)
  // ... type-specific fields
}
```

### Correlation and identity

The `id` field is *usually* a one-shot correlation id, but a few message types intentionally overload it. These special cases are deliberate and the wire field names MUST NOT change:

| Message | Field | Meaning |
|---|---|---|
| `subscribe` | `id` | Correlation id **and** the durable subscription identity. Echoed as `id` on the initial `snapshot`, and as `subscription` on every subsequent `patch`. MUST be unique among the consumer's active subscriptions. |
| `unsubscribe` | `id` | The subscription to cancel — not a fresh correlation id. `unsubscribe` has no correlation id of its own. |
| `query` / `invoke` | `id` | One-shot correlation; echoed as `id` on the `snapshot` / `result` response. |
| `snapshot` | `id` | The `subscribe` or `query` this answers (for subscriptions, the subscription identity). |
| `patch` | `subscription` | The subscription this patch applies to. Named `subscription` rather than `id` because a patch is a stream element, not a response to a single request. |
| `error` | `id` | The `id` of the offending consumer message, when known. |

## Consumer → Provider messages

### `subscribe`

Begin observing a subtree. The provider responds with a `snapshot` and then streams `patch` messages.

```jsonc
{
  "type": "subscribe",
  "id": "sub-1",
  "path": "/",              // Path to the subtree root (default: "/")
  "depth": 2,               // How deep to resolve (default: -1 = unlimited)
  "max_nodes": 200,         // Maximum total nodes in the snapshot (optional)
  "filter": {               // Optional filters
    "types": ["item", "notification"],  // Only include these node types
    "min_salience": 0.5     // Only include nodes with salience >= this value
  }
}
```

**Path syntax:** Forward-slash separated node IDs from the root. `/` is the tree root. `/inbox/msg-42` addresses node `msg-42` under node `inbox` under the root.

A consumer can have multiple active subscriptions on different paths/depths. Each subscription has its own ID.

### `unsubscribe`

Stop observing a subtree.

```jsonc
{
  "type": "unsubscribe",
  "id": "sub-1"             // The subscription ID to cancel
}
```

### `query`

One-shot read of a subtree. Like `subscribe` but returns a single `snapshot` with no ongoing patches.

```jsonc
{
  "type": "query",
  "id": "q-1",
  "path": "/inbox/msg-42",
  "depth": -1,              // Full detail for this message
  "max_nodes": 100,         // Maximum total nodes in the response (optional)
  "window": [0, 50]         // [offset, count] — start at item 0, return 50 items
}
```

### `invoke`

Trigger an affordance on a node.

```jsonc
{
  "type": "invoke",
  "id": "inv-1",
  "path": "/inbox/msg-42",  // Target node
  "action": "reply",        // Affordance action name
  "params": {               // Action parameters
    "body": "Thanks, looks good!"
  }
}
```

## Provider → Consumer messages

### `hello`

Sent once after connection. See [Transport](/spec/core/transport).

```jsonc
{
  "type": "hello",
  "provider": {
    "id": "mail-app",
    "name": "Mail",
    "slop_version": "0.1",
    "capabilities": ["state", "patches", "affordances", "attention"]
  }
}
```

### `snapshot`

Full state tree (or subtree) in response to a `subscribe` or `query`.

```jsonc
{
  "type": "snapshot",
  "id": "sub-1",            // Correlation: which subscribe/query this answers
  "version": 1,             // Monotonically increasing state version
  "seq": 0,                 // Per-subscription sequence; always 0 on snapshot
  "tree": {                 // The state tree (see state-tree.md)
    "id": "root",
    "type": "root",
    "children": [ ... ]
  }
}
```

> `query` responses also use the `snapshot` message shape but omit `seq`
> — there is no subscription to sequence against. See "Version and
> sequence semantics" below.

### `patch`

Incremental update to a subscribed subtree. Uses operations modeled on [JSON Patch (RFC 6902)](https://datatracker.ietf.org/doc/html/rfc6902) with **SLOP path syntax** instead of JSON Pointer (RFC 6901).

```jsonc
{
  "type": "patch",
  "subscription": "sub-1",  // Which subscription this patch applies to
  "version": 2,             // New version after applying this patch
  "seq": 1,                 // Per-subscription seq; MUST equal lastSeq + 1
  "ops": [
    { "op": "replace", "path": "/inbox/msg-42/properties/unread", "value": false },
    { "op": "add", "path": "/inbox/msg-99", "value": { "id": "msg-99", "type": "item", "properties": { "from": "dave", "subject": "New thread" } }, "index": 0 },
    { "op": "remove", "path": "/inbox/msg-10" },
    { "op": "move", "path": "/inbox/msg-42", "index": 3 }
  ]
}
```

**Ops.** The operations are:
| Op | Meaning |
|---|---|
| `add` | Create a field under a node, or insert a child node at `index` (or append if `index` is omitted). |
| `remove` | Delete a field or child node. |
| `replace` | Overwrite an existing field or child node. |
| `move` | Reorder an existing child to a new zero-based `index` among its siblings. `path` is the child's current path (by ID); `index` is the destination position *after* removal from the current position. Required for changing the order of ordered children without tearing down and re-adding them. |

### Patch path syntax

SLOP patch paths use **node-ID segments**, not array indices. This differs from standard JSON Pointer (RFC 6901), which addresses array elements by numeric index.

A path like `/inbox/msg-42/properties/unread` means:

1. Start at the subscription root
2. Find child with `id` "inbox"
3. Find its child with `id` "msg-42"
4. Enter its `properties` object
5. Address the `unread` key

Within `properties`, paths follow standard JSON Pointer key-based addressing. The operations (`add`, `remove`, `replace`) have the same semantics as RFC 6902.

**Escaping inside `/properties/…` and `/meta/…` segments.** Once a path has descended into a non-node field, property keys containing `/` or `~` MUST be escaped using JSON Pointer rules (RFC 6901 §4):
- `~` encoded as `~0`
- `/` encoded as `~1`

So a property literally named `a/b~c` under `msg-42` is addressed as `/inbox/msg-42/properties/a~1b~0c`. Node-ID segments (the parts before reserved keywords like `properties`) are NOT escaped — node IDs are forbidden from containing `/` or `~` in the first place (see [State Tree §id](/spec/core/state-tree#id)).

This design means patches are **stable across reordering** — moving a message from position 0 to position 5 does not invalidate paths that reference it by ID.

**Reserved field keywords.** The segments `properties`, `children`, `affordances`, `meta`, and `content_ref` are **reserved**: when one appears as a segment while walking a node, the remaining path is interpreted relative to that field of the node rather than as a child-id lookup. A reserved keyword always takes precedence over child-id resolution, and node `id` values MUST NOT equal a reserved keyword (see [State Tree §id](/spec/core/state-tree#id)). Once the path has descended into a non-node field (e.g. inside `properties` or `meta`), subsequent segments are plain JSON Pointer keys and the reservation no longer applies — a property literally named `properties` is addressed normally.

**Version and sequence semantics:**

SLOP messages carry two monotonically increasing integers, each with a distinct job:

- `version` — a single *provider-global* counter. Every change that produces patches increments it, and that integer is stamped on every message emitted to any active subscription or query response until the next change. Two consumers subscribing at the same moment see the same `version`; two subscriptions on one consumer are directly comparable. `version` is the right field for re-base and staleness checks (e.g., "discard buffered patches whose version ≤ the latest snapshot's version").
- `seq` — a *per-subscription* counter. The provider assigns `seq: 0` to the initial `snapshot` answering a `subscribe`, and `seq: 1, 2, 3, …` to successive `patch` messages on that subscription. `seq` is the right field for gap detection, because the provider only emits patches to subscriptions whose projected subtree actually changed — so `version` can advance between two consecutive patches on a given subscription without any values in between, making version-based gap detection unsound.

`snapshot` and `patch` MUST carry both fields. `query` responses carry the provider's current `version` but no `seq` (there is no subscription to sequence against).

Consumer rules:

- On the initial `snapshot` for a subscription, the consumer records `lastSeq = 0` and `lastVersion = snapshot.version`.
- On each `patch`, the consumer asserts `patch.seq == lastSeq + 1`. If it is greater, a patch was lost and the consumer MUST recover by sending `unsubscribe` then a fresh `subscribe` (or equivalent resubscribe). The provider answers with a new `snapshot` whose `seq: 0` re-bases the sequence, and any buffered patches whose `version ≤ snapshot.version` MUST be discarded.
- `version` decreases are protocol violations; a consumer seeing one MAY disconnect.

This is also what providers emit when applying backpressure (see [Rate limiting and backpressure](#rate-limiting-and-backpressure)): a fresh `snapshot` carrying the current version and `seq: 0` — the consumer treats it as a re-base.

Reference SDKs expose the global counter via `ProviderBase.getVersion()` (TypeScript), `SlopServer::version()` (Rust), `Server.Version()` (Go), and the `version` field on Python's `SlopServer`. Per-subscription `seq` is tracked inside the subscription record on each side and MUST NOT be visible to application code.

### `result`

Response to an `invoke`.

```jsonc
{
  "type": "result",
  "id": "inv-1",            // Correlation: which invoke this answers
  "status": "ok",           // "ok", "error", or "accepted"
  "data": {                 // Optional: action-specific return data
    "message_id": "sent-123"
  }
}
```

On error:

```jsonc
{
  "type": "result",
  "id": "inv-1",
  "status": "error",
  "error": {
    "code": "invalid_params",
    "message": "body is required for reply action"
  }
}
```

**Error codes:**

| Code | Meaning |
|---|---|
| `not_found` | Target node or action doesn't exist |
| `invalid_params` | Parameters failed validation |
| `unauthorized` | Consumer/session lacks permission, or policy forbids this action |
| `conflict` | Action can't be performed in the current live state, even if it appeared valid in an earlier snapshot |
| `internal` | Provider-side error |

### Extended result statuses

Extensions may define additional `status` values. The `accepted` status (defined in [Async Actions](/spec/extensions/async-actions)) indicates the action has started asynchronously — analogous to HTTP 202. The `data` field will contain a `taskId` referencing a progress node in the state tree.

Consumers that do not support async actions should treat `accepted` as `ok`.

### `event`

An out-of-band event that doesn't map to a state change. Used for transient signals.

```jsonc
{
  "type": "event",
  "name": "user-navigation",
  "data": {
    "from": "/settings",
    "to": "/inbox"
  }
}
```

Events are informational. The consumer should not rely on events for state — state changes come through patches.

### `error`

Sent when the provider cannot process a consumer message (other than `invoke`, which uses `result`).

```jsonc
{
  "type": "error",
  "id": "sub-1",            // Correlation: which message caused the error (if known)
  "error": {
    "code": "not_found",
    "message": "Path /nonexistent does not exist in the state tree"
  }
}
```

Error codes are the same as for `result` errors, plus:

| Code | Meaning |
|---|---|
| `bad_request` | Message is malformed or has an unknown type |
| `not_supported` | Requested capability is not supported by this provider |

If the error is not associated with a specific consumer message (e.g., internal provider failure), `id` may be omitted.

## Message ordering

- Messages within a subscription are strictly ordered: `snapshot` before any `patch`, patches in version order.
- Messages across subscriptions have no ordering guarantee.
- `result` messages for `invoke` may arrive interleaved with patches from unrelated state changes. The `id` field correlates responses.
- **Invoke results and their patches:** state changes made by an invoke handler MUST be broadcast — as `patch` (or re-base `snapshot`) messages to the connection's affected subscriptions — *before* the provider sends the corresponding `result` on that connection. A consumer that processes messages in receive order can therefore assume its local mirror already reflects the action's effects by the time it reads an `ok` result; consumers SHOULD apply all patches received ahead of a result before re-reading affected state. For `accepted` (async) results, this ordering covers only changes made before the handler returned — subsequent progress arrives in later patches.

## Batch messages

For efficiency, a provider may batch multiple patches into one message:

```jsonc
{
  "type": "batch",
  "messages": [
    { "type": "patch", "subscription": "sub-1", "version": 3, "seq": 2, "ops": [ ... ] },
    { "type": "patch", "subscription": "sub-2", "version": 7, "seq": 5, "ops": [ ... ] }
  ]
}
```

Consumers must support `batch` messages by unwrapping and processing each inner message in order.

## Rate limiting and backpressure

- Providers should coalesce rapid state changes into fewer patches (e.g., debounce at 50–100ms).
- If a consumer is slow to read, the provider may skip intermediate versions and send a fresh `snapshot` (stamped with the current provider version) instead of accumulated patches. The snapshot replaces any buffered state for that subscription; consumers MUST discard patches for that subscription whose `version` is ≤ the snapshot's `version`.
- Consumers can signal backpressure by sending a `pause` / `resume` for a subscription (optional capability, not required in v0.1).
