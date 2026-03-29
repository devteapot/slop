---
title: "Affordances"
---

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

Affordances are invoked via the `invoke` message (see [04 — Messages](./04-messages.md)):

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

## Root affordances

Some actions are app-global, not tied to a specific entity. These live on the root node:

```jsonc
{
  "id": "root",
  "type": "root",
  "properties": { "label": "Mail" },
  "affordances": [
    { "action": "compose", "description": "Start a new email" },
    { "action": "search", "params": { "type": "object", "properties": { "query": { "type": "string" } } } },
    { "action": "refresh" }
  ]
}
```
