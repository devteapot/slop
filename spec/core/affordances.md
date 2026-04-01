# Affordances

Affordances are the action layer of SLOP. They describe what can be done, where it can be done, and how.

## What makes affordances different from tools

In tool-based systems (MCP, OpenAI function calling), the AI receives a flat list of available functions — disconnected from state. The AI must figure out *when* each tool is applicable and *what* to pass to it by reading documentation.

In SLOP, affordances are **attached to state nodes**. They appear in context — the AI sees a message node and, alongside its properties, sees that it can be replied to, archived, or forwarded. Affordances come and go as state changes: a "merge" affordance appears on a PR only when it's mergeable.

Key differences:

| | Tools (MCP, etc.) | Affordances (SLOP) |
|---|---|---|
| Scope | Global flat list | Per-node, contextual |
| Availability | Always listed (may fail at runtime) | Only present when valid |
| Discovery | Read tool descriptions | See them alongside state |
| Parameters | Must be inferred from docs | Defined with JSON Schema, contextualized |

## Affordance schema

```jsonc
{
  "action": "reply",                    // Identifier (unique within the node)
  "label": "Reply",                     // Human-readable label (optional)
  "description": "Reply to this message", // For AI understanding (optional)
  "params": {                           // JSON Schema for parameters (optional)
    "type": "object",
    "properties": {
      "body": {
        "type": "string",
        "description": "Reply body text"
      },
      "reply_all": {
        "type": "boolean",
        "default": false
      }
    },
    "required": ["body"]
  },
  "dangerous": false,                   // Requires confirmation (optional, default false)
  "idempotent": false,                  // Safe to retry (optional, default false)
  "estimate": "instant"                 // Expected duration hint (optional)
}
```

### Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `action` | yes | string | Action identifier, unique within the node |
| `label` | no | string | Human-readable name |
| `description` | no | string | Explains what this does (for AI) |
| `params` | no | JSON Schema | Parameter schema (if the action takes input) |
| `dangerous` | no | boolean | If true, consumer should confirm before invoking |
| `idempotent` | no | boolean | If true, safe to call multiple times |
| `estimate` | no | string | Duration hint: `"instant"`, `"fast"` (<1s), `"slow"` (>1s), `"async"` (background) |

### Parameterless affordances

Many affordances take no input — they're contextual actions with all information already implicit:

```jsonc
{
  "id": "msg-42",
  "type": "item",
  "properties": { "subject": "Launch plan", "unread": true },
  "affordances": [
    { "action": "open" },
    { "action": "mark_read" },
    { "action": "archive" },
    { "action": "delete", "dangerous": true }
  ]
}
```

The AI doesn't need to pass a message ID to "archive" — the affordance is on the node, so the target is implicit.

## Dynamic affordances

Affordances are part of state. They change as state changes:

```jsonc
// Before CI passes — no merge affordance
{
  "id": "pr-123",
  "type": "github:pull-request",
  "properties": { "status": "checks_pending", "mergeable": false },
  "affordances": [
    { "action": "comment", "params": { ... } },
    { "action": "close" }
  ]
}

// After CI passes — merge becomes available
{
  "id": "pr-123",
  "type": "github:pull-request",
  "properties": { "status": "checks_passed", "mergeable": true },
  "affordances": [
    { "action": "merge", "description": "Merge this PR into main" },
    { "action": "comment", "params": { ... } },
    { "action": "close" }
  ]
}
```

The consumer doesn't need conditional logic to know when merging is possible — the affordance's presence *is* the signal.

## Invoking affordances

Affordances are invoked via the `invoke` message (see [Messages](./messages.md)):

```jsonc
{
  "type": "invoke",
  "id": "inv-1",
  "path": "/prs/pr-123",
  "action": "merge",
  "params": {}
}
```

The provider:
1. Validates the action exists on the target node
2. Validates parameters against the affordance's `params` schema
3. Executes the action
4. Returns a `result` message
5. Emits state `patch` messages reflecting any state changes caused by the action

## Confirmation pattern

When `dangerous: true`, the protocol itself doesn't enforce confirmation — it's a hint to the consumer. The consumer (AI system) should:

1. Recognize the `dangerous` flag
2. Present the action to the user for confirmation before invoking
3. Only invoke after explicit approval

This keeps policy in the consumer, not the provider.

## Compound actions

Sometimes an action requires multiple steps (e.g., "merge and delete branch"). Rather than encoding workflows in the protocol, use **sequential invocations**. The provider updates state after each action, and new affordances appear for the next step.

```
1. AI sees "merge" affordance on PR → invokes it
2. Provider merges, state updates, "delete_branch" affordance appears
3. AI sees "delete_branch" → invokes it (or doesn't)
```

This keeps each affordance atomic and lets the AI make decisions between steps.

## Affordance declaration

Affordances must be **declared in the node's descriptor** to appear in the state tree. The descriptor is the source of truth for what the consumer sees.

A handler registered separately (e.g., for routing or middleware) does not automatically create an affordance in the tree. If a developer registers a handler for `"delete"` on a node but doesn't include `"delete"` in the node's affordances, the action is callable but invisible to the consumer. This is intentional — it allows providers to have internal actions that aren't exposed to AI consumers.

## Affordance placement

Affordances should be placed on the node they operate on. This applies at every level:

| Scope | Affordance examples | Where to place |
|---|---|---|
| **Item** | edit, delete, toggle, archive | On the item node |
| **Collection** | add, clear, search, sort, export | On the collection node |
| **View** | refresh, change_layout | On the view node |
| **App-global** | navigate, compose, logout | On the root or a `context` child |

App-level affordances (search, navigate, compose) should be placed on the **node they operate on** rather than the root. For example, `search` belongs on the collection it searches, `navigate` on a navigation context node. This keeps affordances co-located with the state they affect and ensures consistent behavior across SDK implementations.

The root node carries the app's identity (`id`, `name`, `version`) and may hold truly global affordances like `logout`, but most actions belong on their target node.

## Consumer tool-name conventions

When an AI consumer converts affordances to LLM function tools (e.g., for OpenAI, Gemini, or Claude tool-use), it needs a tool name for each affordance. The protocol does not prescribe naming, but SDKs SHOULD follow this convention:

### Short names: `{nodeId}__{action}`

Tool names use the **node ID and action only**, not the full tree path. The LLM already has the full tree as context (via `formatTree` or equivalent) — encoding the path in the name is redundant and wastes tokens.

```
card_123__edit          ← 14 chars (short, readable)
backlog__reorder        ← 16 chars
```

Since affordance `action` values are unique within a node, and node IDs are unique within their parent, the combination `{nodeId}__{action}` is usually globally unique. When it's not (two nodes share the same ID at different branches), prepend the parent ID:

```
board_1__backlog__reorder    ← board-1's backlog
board_2__backlog__reorder    ← board-2's backlog
```

Continue prepending ancestors until unique.

### Resolve map, not path encoding

The `affordancesToTools` utility SHOULD return a resolve function (or map) alongside the tools. The consumer uses this to map a tool name back to the full `{ path, action }` needed for the `invoke` message. This keeps the encoding lossless without baking the path into the name.

```
Tool name:  card_123__edit
Resolves to: { path: "/inbox/messages/card-123", action: "edit" }
→ invoke message: { type: "invoke", path: "/inbox/messages/card-123", action: "edit" }
```

### Sanitization

Node IDs and action names SHOULD be sanitized to `[a-zA-Z0-9_]` in tool names (replacing hyphens and other characters with underscores). This ensures compatibility with LLM providers that restrict function name characters (e.g., Gemini requires `[a-zA-Z_][a-zA-Z0-9_]*`, max 64 chars).

### Multi-provider prefix

When a consumer connects to multiple providers, tool names SHOULD be prefixed with the provider name to avoid collisions: `{providerName}__{nodeId}__{action}`.

### Length limits and deep trees

Some LLM providers impose function name length limits (e.g., Gemini: 64 characters). Short names stay well within limits for typical apps:

| Scenario | Example | Length |
|---|---|---|
| Simple node + action | `card_123__edit` | 14 |
| UUID node + action | `550e8400_e29b_41d4_a716_446655440000__edit` | 42 |
| Multi-provider + UUID | `my_app__550e8400_e29b_41d4_a716_446655440000__edit` | 50 |
| Disambiguated UUID + UUID parent | `550e8400_...440001__550e8400_...440000__edit` | **79** |

The last case — UUID collision requiring a UUID parent prefix — exceeds 64 chars. This is rare (requires two sibling-level nodes with identical IDs at different branches, both with long IDs), but possible in deep trees with UUID-based identifiers.

**Mitigation:** Consumer implementations SHOULD apply a hash-based truncation when sanitized names exceed the provider's limit. Truncate to `limit - 8` characters and append `_` plus a 7-character hash of the full name. This preserves uniqueness while respecting the limit:

```
fn_550e8400_e29b_41d4_a716_446655440001__550e8400_e29b → exceeds 64
fn_550e8400_e29b_41d4_a716_446655440001__550e84_k3m7x9w → 64 chars, unique
```

**Provider guidance:** Prefer short, human-readable node IDs (e.g., `card-123`, `inbox`, `settings`) over UUIDs where possible. Short IDs produce better tool names, clearer tree output, and avoid length limit issues entirely.
