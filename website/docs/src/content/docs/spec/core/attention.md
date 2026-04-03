---
title: "Attention & Salience"
---
An AI reading a state tree faces the same problem a human faces with a cluttered screen: *what matters right now?* Attention hints help the AI focus its limited context window on what's relevant.

## The problem

A state tree for a complex app can have thousands of nodes. Dumping the entire tree into an AI's context is wasteful and can degrade performance. The AI needs signals about where to look.

Attention hints are **optional metadata** on nodes that guide the consumer's focus. They are soft signals, not hard constraints — the consumer may ignore them.

## Meta fields for attention

These fields live in the `meta` object of any node:

```jsonc
{
  "meta": {
    "salience": 0.9,          // How important is this node right now
    "changed": true,           // Was this node modified in the last patch
    "focus": true,             // Is the user currently focused on this
    "urgency": "high",         // Time-sensitivity
    "reason": "User is composing a reply to this thread"  // Why this is salient
  }
}
```

### `salience` (number, 0–1)

A score indicating how relevant this node is to the current moment. Providers compute salience based on app-specific logic.

| Score | Meaning | Example |
|---|---|---|
| 0.0 | Background, irrelevant | Collapsed sidebar section |
| 0.1–0.3 | Low — present but not active | Read messages |
| 0.4–0.6 | Medium — relevant context | Recent messages in active thread |
| 0.7–0.9 | High — the AI should probably read this | Selected item, active form |
| 1.0 | Critical — must not miss | Error, alert, blocking issue |

Salience is relative within a tree. It helps the consumer decide *what to read first*, not whether something exists.

### `pinned` (boolean)

When `true`, this node and its children must never be collapsed by auto-compaction, regardless of salience score or node budget. Use for subtrees that should always be visible to the AI — such as the `ui` node in fullstack apps, or critical status indicators.

Default: `false`.

### `changed` (boolean)

Set to `true` on nodes that were modified in the most recent patch. Automatically cleared on the next patch cycle. This lets the consumer quickly scan for what's new without diffing.

### `focus` (boolean)

Indicates the user is currently interacting with or looking at this node. Typically only one node (or a small set) has `focus: true` at any time.

Focus is distinct from salience — a node can be high-salience without focus (an unread alert) or focused without high salience (the user is looking at something mundane).

### `urgency` (string)

A categorical signal about time-sensitivity:

| Value | Meaning |
|---|---|
| `none` | No time pressure (default) |
| `low` | Worth noting eventually |
| `medium` | Should be addressed soon |
| `high` | Needs prompt attention |
| `critical` | Requires immediate action (blocking the user, error state) |

### `reason` (string)

A natural language hint explaining *why* this node is salient. Useful for AI comprehension:

```jsonc
{
  "id": "deploy-status",
  "type": "status",
  "properties": { "status": "failing", "service": "api" },
  "meta": {
    "salience": 1.0,
    "urgency": "critical",
    "reason": "Production deploy is failing — user triggered it 2 minutes ago and is waiting"
  }
}
```

## Attention-aware subscriptions

Consumers can use salience to filter subscriptions (see [Messages](/spec/core/messages)):

```jsonc
{
  "type": "subscribe",
  "id": "sub-1",
  "path": "/",
  "depth": 2,
  "filter": {
    "min_salience": 0.5    // Only include nodes with salience >= 0.5
  }
}
```

This is the primary mechanism for managing token budget. The AI subscribes to "everything important" rather than "everything."

When salience changes and a previously-filtered node crosses the threshold, the provider sends a patch adding it to the consumer's view. When it drops below, the provider sends a remove.

## Attention digest

For very large trees, the provider can offer an **attention digest** — a pre-computed summary of what matters:

```jsonc
{
  "type": "snapshot",
  "id": "digest-1",
  "version": 42,
  "tree": {
    "id": "attention-digest",
    "type": "root",
    "meta": {
      "summary": "2 critical items, 5 changes since last check"
    },
    "children": [
      {
        "id": "deploy-status",
        "type": "status",
        "properties": { "status": "failing" },
        "meta": { "salience": 1.0, "urgency": "critical" }
      },
      {
        "id": "msg-99",
        "type": "item",
        "properties": { "from": "boss", "subject": "Urgent: client escalation" },
        "meta": { "salience": 0.95, "urgency": "high", "changed": true }
      }
    ]
  }
}
```

The consumer requests this with:

```jsonc
{
  "type": "query",
  "id": "digest-1",
  "path": "/",
  "depth": 1,
  "filter": { "min_salience": 0.7 }
}
```

This gives the AI a quick "what's going on?" read in minimal tokens, from which it can drill into specific nodes.

## Provider guidelines

- **Don't set everything to high salience.** If everything is important, nothing is. Use the full 0–1 range.
- **Update salience as context changes.** A node's salience should reflect the current moment, not a static priority.
- **Use `reason` generously.** It's cheap (one string) and extremely valuable for AI comprehension.
- **Set `focus` based on actual user interaction**, not guesses. It should reflect what the user is looking at or typing into right now.
- **`changed` should auto-clear.** It marks the *last* change, not all historical changes.

## Tree optimization

Tree optimization transforms the raw state tree into a right-sized snapshot for a consumer's context window. There are two distinct concerns:

1. **Semantic metadata** — salience scores, pinned flags, focus, changed, urgency. These are intrinsically provider-side: only the app knows what's relevant right now.
2. **Presentation constraints** — how much tree the consumer wants. Depth limits, node budgets, type filters, windowing. The consumer is best positioned to set these because it knows its own token budget.

### Who controls what

| Parameter | Set by | Rationale |
|---|---|---|
| `salience` | Provider | App-specific relevance scoring |
| `pinned` | Provider | App knows which subtrees must survive compaction |
| `focus`, `changed`, `urgency` | Provider | Real-time app state |
| `depth` | Consumer | Controls resolution granularity |
| `filter.min_salience` | Consumer | Token budget — "only show me what's important" |
| `filter.types` | Consumer | Relevance — "I only care about these node types" |
| `window` | Consumer | Pagination within large collections |
| `max_nodes` | Consumer | Hard token budget cap |

### Consumer-driven optimization

Consumers request all presentation constraints via `subscribe` and `query` messages. The `max_nodes` field belongs in the consumer's request, not in the server's configuration:

```jsonc
{
  "type": "subscribe",
  "id": "sub-1",
  "path": "/",
  "depth": 2,
  "max_nodes": 200,
  "filter": {
    "types": ["item", "notification"],
    "min_salience": 0.3
  }
}
```

```jsonc
{
  "type": "query",
  "id": "q-1",
  "path": "/inbox",
  "depth": -1,
  "max_nodes": 100,
  "window": [0, 50]
}
```

When `max_nodes` is present, the provider applies auto-compaction after depth truncation and filtering, collapsing lowest-salience subtrees until the tree fits within the budget. Pinned nodes are never collapsed.

The provider MAY enforce a global ceiling (e.g., never send more than 500 nodes regardless of what the consumer asks for), but the consumer's `max_nodes` takes precedence when it is more restrictive.

### Optimization pipeline

Providers MUST apply optimizations in this order:

1. **Filter** — Remove nodes below `filter.min_salience` or not in `filter.types`. The root is never filtered.
2. **Truncate** — Collapse nodes beyond `depth` into stubs with `meta.total_children` and `meta.summary`.
3. **Compact** — If the tree still exceeds `max_nodes`, collapse lowest-salience subtrees first. Scoring: `score = salience - depth × 0.01 - childCount × 0.001`. Root children and pinned nodes are never collapsed.
4. **Window** — For `query` messages with `window`, slice the requested node's children and set `meta.window` and `meta.total_children`.

Each step is optional and only applies when the corresponding parameter is present.

### Compaction behavior

When a subtree is collapsed during compaction:

- The node retains its `id`, `type`, `properties`, `affordances`, and `meta`
- `children` is removed
- `meta.total_children` is set to the original child count
- `meta.summary` is preserved if already set, otherwise defaults to `"{N} children"`
- The consumer can drill into collapsed nodes via a follow-up `query` with a deeper depth

This ensures the AI always knows *something was there* and can explore further if needed.

### Why consumer-driven

Different consumers have different budgets. A CLI agent with 8k context needs a very compact tree. A desktop agent with 200k context can handle the full thing. A browser extension might sit somewhere in between. If the server decides the budget, it's guessing — and guessing wrong either wastes tokens or hides relevant state.

By letting the consumer declare its budget, the server can serve every consumer optimally from the same tree. The server's job reduces to: compute accurate salience, mark pinned nodes, and respect whatever budget the consumer requests.

### Interaction with subscriptions

When a consumer subscribes with `max_nodes`, the provider MUST respect the budget in subsequent patch cycles. Each broadcast re-applies the stored `max_nodes` when computing the per-subscription output tree, then diffs against the last sent tree. This keeps the consumer's view within budget as the tree evolves.

The consumer can adjust its budget by unsubscribing and re-subscribing with a new `max_nodes`.
