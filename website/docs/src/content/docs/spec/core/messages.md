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

## Consumer → Provider messages

### `subscribe`

Begin observing a subtree. The provider responds with a `snapshot` and then streams `patch` messages.

```jsonc
{
  "type": "subscribe",
  "id": "sub-1",
  "path": "/",              // Path to the subtree root (default: "/")
  "depth": 2,               // How deep to resolve (default: 1, -1 = unlimited)
  "filter": {               // Optional filters
    "types": ["item", "notification"],  // Only include these node types
    "min_salience": 0.5     // Only include nodes above this salience
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

Sent once after connection. See [Transport](./transport.md).

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
  "tree": {                 // The state tree (see state-tree.md)
    "id": "root",
    "type": "root",
    "children": [ ... ]
  }
}
```

### `patch`

Incremental update to a subscribed subtree. Uses operations modeled on [JSON Patch (RFC 6902)](https://datatracker.ietf.org/doc/html/rfc6902) with **SLOP path syntax** instead of JSON Pointer (RFC 6901).

```jsonc
{
  "type": "patch",
  "subscription": "sub-1",  // Which subscription this patch applies to
  "version": 2,             // New version after applying this patch
  "ops": [
    { "op": "replace", "path": "/inbox/msg-42/properties/unread", "value": false },
    { "op": "add", "path": "/inbox/msg-99", "value": { "id": "msg-99", "type": "item", "properties": { "from": "dave", "subject": "New thread" } } },
    { "op": "remove", "path": "/inbox/msg-10" }
  ]
}
```

### Patch path syntax

SLOP patch paths use **node-ID segments**, not array indices. This differs from standard JSON Pointer (RFC 6901), which addresses array elements by numeric index.

A path like `/inbox/msg-42/properties/unread` means:

1. Start at the subscription root
2. Find child with `id` "inbox"
3. Find its child with `id` "msg-42"
4. Enter its `properties` object
5. Address the `unread` key

Within `properties`, paths follow standard JSON Pointer key-based addressing. The operations (`add`, `remove`, `replace`) have the same semantics as RFC 6902.

This design means patches are **stable across reordering** — moving a message from position 0 to position 5 does not invalidate paths that reference it by ID.

**Version semantics:**
- Versions are monotonically increasing integers, scoped to a subscription
- The consumer can detect missed patches via version gaps
- If a gap is detected, the consumer should re-subscribe to get a fresh snapshot

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
| `unauthorized` | Consumer lacks permission for this action |
| `conflict` | Action can't be performed in current state |
| `internal` | Provider-side error |

### Extended result statuses

Extensions may define additional `status` values. The `accepted` status (defined in [Async Actions](../extensions/async-actions.md)) indicates the action has started asynchronously — analogous to HTTP 202. The `data` field will contain a `taskId` referencing a progress node in the state tree.

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
- `result` messages for `invoke` may arrive interleaved with patches. The `id` field correlates responses.

## Batch messages

For efficiency, a provider may batch multiple patches into one message:

```jsonc
{
  "type": "batch",
  "messages": [
    { "type": "patch", "subscription": "sub-1", "version": 3, "ops": [ ... ] },
    { "type": "patch", "subscription": "sub-2", "version": 7, "ops": [ ... ] }
  ]
}
```

Consumers must support `batch` messages by unwrapping and processing each inner message in order.

## Rate limiting and backpressure

- Providers should coalesce rapid state changes into fewer patches (e.g., debounce at 50–100ms).
- If a consumer is slow to read, the provider may skip intermediate versions and send a fresh snapshot instead of accumulated patches.
- Consumers can signal backpressure by sending a `pause` / `resume` for a subscription (optional capability, not required in v0.1).
