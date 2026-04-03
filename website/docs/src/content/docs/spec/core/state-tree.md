---
title: "State Tree"
---
The state tree is the core data structure of SLOP. It is a rooted tree of **nodes**, where each node represents a semantic unit of application state.

## Node schema

```jsonc
{
  // REQUIRED
  "id": "msg-42",          // Stable identifier, unique within the tree
  "type": "message",       // Semantic type (see type taxonomy below)

  // OPTIONAL
  "properties": {          // Key-value pairs — the actual state
    "from": "alice@co.org",
    "subject": "Launch plan",
    "body": "Let's ship next week...",
    "unread": true,
    "timestamp": "2026-03-27T10:30:00Z"
  },
  "children": [ ... ],     // Ordered list of child nodes
  "affordances": [ ... ],  // Actions available on this node (see affordances.md)
  "meta": { ... },         // Attention hints and tree metadata (see below)
  "content_ref": { ... }   // Reference to large content (see extensions/content-references.md)
}
```

### `id`

A string that uniquely identifies a node within the tree. Must be stable across patches — if a node's `id` changes, it's a different node. IDs are opaque to consumers; providers choose the format.

**Requirements:**
- Unique among siblings (no two children of the same parent share an ID)
- Stable across updates (the same logical entity keeps its ID)
- Must not change when properties change

### `type`

A string describing what kind of thing this node represents. Types are semantic, not structural — they describe meaning, not UI.

**Core types** (providers may define custom types):

| Type | Meaning | Example |
|---|---|---|
| `root` | Top-level container | The app itself |
| `view` | A screen or page the user is on | Inbox view, settings page |
| `collection` | An ordered set of items | Message list, file browser |
| `item` | A single entity in a collection | One email, one file |
| `document` | A piece of content | Email body, code file, note |
| `form` | An input area | Compose window, search bar |
| `field` | A single input | To: field, subject line |
| `control` | An interactive element | Button, toggle, dropdown |
| `status` | A status indicator | Loading spinner, error banner |
| `notification` | Something demanding attention | Alert, toast, badge |
| `media` | Rich content | Image, video, chart |
| `group` | Logical grouping | Sidebar section, tab group |
| `context` | Ambient state | Current user, selected account, theme |

Custom types should use a namespace prefix: `github:pull-request`, `vscode:editor-tab`.

### `properties`

A flat or shallowly nested key-value map. Properties hold the actual state payload of the node. Property keys are strings; values are JSON-serializable.

Properties are **not prescribed by the protocol** — each app defines what properties its nodes carry. However, some well-known property names have conventional meaning:

| Property | Type | Meaning |
|---|---|---|
| `label` | string | Human-readable name or title |
| `description` | string | Longer description |
| `value` | any | Primary value (for fields, controls) |
| `selected` | boolean | Whether this node is currently selected |
| `disabled` | boolean | Whether this node is currently inactive |
| `visible` | boolean | Whether this node is visible to the user (default: true) |
| `count` | number | Count of items (for collections, badges) |
| `url` | string | Associated URL |
| `icon` | string | Icon identifier |
| `error` | string | Error state |

### `children`

An ordered array of child nodes. Children represent containment — an inbox *contains* messages, a form *contains* fields.

Children may be:
- **Inline** — the full node object is present
- **Truncated** — only `id`, `type`, and summary `meta` are present (see progressive disclosure below)
- **Omitted** — `children` is absent or null, but `meta.total_children` indicates they exist

### `meta`

Metadata about the node itself (not the domain data). See [Attention & Salience](/spec/core/attention) for the full meta schema. Key fields:

```jsonc
{
  "meta": {
    "summary": "12 unread messages, 3 flagged",  // NL summary for truncated subtrees
    "salience": 0.8,          // 0–1, how relevant this node is right now
    "pinned": false,          // If true, never collapse this node or its children during auto-compaction
    "changed": true,          // This node was modified in the last patch
    "total_children": 142,    // Total children (when not all are inline)
    "window": [0, 25],        // Which slice of children is inline [offset, count]
    "created": "2026-03-27T10:30:00Z",
    "updated": "2026-03-27T10:35:00Z"
  }
}
```

## Progressive disclosure

The state tree supports **depth-controlled resolution**. When a consumer requests a subtree at depth `d`:

- **Depth 0**: Only the requested node (no children)
- **Depth 1**: The node + direct children (children's children omitted)
- **Depth N**: N levels of nesting resolved
- **Depth -1**: Full subtree (use with caution)

Nodes beyond the requested depth are **stubs** — they include `id`, `type`, and `meta` (especially `summary` and `total_children`) but not `properties` or `children`.

This lets the AI start with a high-level view and drill into what's relevant, managing its own token budget.

A stub node includes only `id`, `type`, and `meta` — no `properties`, `children`, or `affordances`:

```jsonc
{
  "id": "msg-42",
  "type": "item",
  "meta": {
    "summary": "Launch plan from alice (unread)",
    "total_children": 2
  }
}
```

```
Depth 0:
  inbox (12 unread, 142 total)

Depth 1:
  inbox
    ├── msg-1: "Launch plan" from alice (unread)
    ├── msg-2: "Bug report" from bob
    ├── msg-3: "Meeting notes" from carol
    ... (25 of 142 shown)

Depth 2:
  inbox
    ├── msg-1: "Launch plan" from alice (unread)
    │   ├── attachment: "plan.pdf" (2.1 MB)
    │   └── thread: 3 replies
    ...
```

## Windowed collections

When a collection has many children, the provider returns a **window** (a contiguous slice) and metadata about the full set:

```jsonc
{
  "id": "inbox",
  "type": "collection",
  "properties": { "label": "Inbox" },
  "meta": {
    "total_children": 142,
    "window": [0, 25],
    "summary": "142 messages, 12 unread, 3 flagged"
  },
  "children": [
    // 25 nodes (indices 0–24)
  ]
}
```

The consumer can request a different window via a `query` message (see [Messages](/spec/core/messages)).

## Consumer display format

When rendering a state tree as text for LLM context (e.g. in a system prompt or tool result), consumers SHOULD use the following canonical format. A consistent format across SDKs ensures the AI can parse tree output regardless of which SDK produced it.

### Format rules

1. **Each node occupies one line**, indented by 2 spaces per depth level.
2. **Header**: `[type] id` — always show the node type and stable ID. If the node has a `label` or `title` property that differs from the ID, append it: `[type] id: Display Name`.
3. **Extra properties**: All properties except `label` and `title`, formatted as `key=value` in parentheses: `(count=3, unread=true)`. Values are JSON-encoded.
4. **Meta summary**: When `meta.summary` is present, append `  — "summary text"` (em-dash, quoted).
5. **Meta salience**: When `meta.salience` is present, append `  salience=0.85` (rounded to 2 decimal places).
6. **Affordances**: Inline at end of line as `  actions: {action1(param: type), action2}`. Parameter types are extracted from the affordance's JSON Schema `params.properties`.
7. **Windowing**: When `meta.total_children > len(children)`:
   - If `meta.window` is set: add a child line `(showing N of M)`
   - If no children are inline: add a child line `(M children not loaded)`
8. **Children**: Recurse at `indent + 1`.

### Example

Given this tree:

```jsonc
{
  "id": "store",
  "type": "root",
  "properties": { "label": "Pet Store" },
  "meta": { "salience": 0.9 },
  "affordances": [
    { "action": "search", "params": { "type": "object", "properties": { "query": { "type": "string" } } } }
  ],
  "children": [
    {
      "id": "catalog",
      "type": "collection",
      "properties": { "label": "Catalog", "count": 142 },
      "meta": {
        "total_children": 142,
        "window": [0, 25],
        "summary": "142 products, 12 on sale"
      },
      "children": [
        {
          "id": "prod-1",
          "type": "item",
          "properties": { "label": "Rubber Duck", "price": 4.99, "in_stock": true },
          "affordances": [
            { "action": "add_to_cart", "params": { "type": "object", "properties": { "quantity": { "type": "number" } } } },
            { "action": "view" }
          ]
        }
      ]
    },
    {
      "id": "cart",
      "type": "collection",
      "properties": { "label": "Cart" },
      "meta": { "total_children": 3, "summary": "3 items, $24.97" }
    }
  ]
}
```

The canonical text output is:

```
[root] store: Pet Store  salience=0.9  actions: {search(query: string)}
  [collection] catalog: Catalog (count=142)  — "142 products, 12 on sale"
    (showing 1 of 142)
    [item] prod-1: Rubber Duck (price=4.99, in_stock=true)  actions: {add_to_cart(quantity: number), view}
  [collection] cart: Cart  — "3 items, $24.97"
    (3 children not loaded)
```

## Example: full state tree

A code editor exposing its state:

```jsonc
{
  "id": "vscode",
  "type": "root",
  "properties": {
    "label": "VS Code",
    "workspace": "/home/user/my-project"
  },
  "children": [
    {
      "id": "editor-group-1",
      "type": "group",
      "properties": { "label": "Editor" },
      "children": [
        {
          "id": "tab-main.ts",
          "type": "document",
          "properties": {
            "label": "main.ts",
            "language": "typescript",
            "path": "src/main.ts",
            "selected": true,
            "dirty": true,
            "cursor": { "line": 42, "col": 10 },
            "visible_range": { "start": 30, "end": 60 }
          },
          "affordances": [
            { "action": "save" },
            { "action": "close" },
            { "action": "goto", "params": { "line": "number" } }
          ]
        },
        {
          "id": "tab-readme",
          "type": "document",
          "properties": {
            "label": "README.md",
            "selected": false,
            "dirty": false
          }
        }
      ]
    },
    {
      "id": "terminal-1",
      "type": "view",
      "properties": {
        "label": "Terminal",
        "shell": "zsh",
        "cwd": "/home/user/my-project"
      },
      "meta": {
        "summary": "Last command: npm test (exit 0)"
      }
    },
    {
      "id": "problems",
      "type": "collection",
      "properties": { "label": "Problems" },
      "meta": {
        "total_children": 3,
        "summary": "2 errors, 1 warning"
      },
      "children": [
        {
          "id": "err-1",
          "type": "notification",
          "properties": {
            "severity": "error",
            "message": "Type 'string' is not assignable to type 'number'",
            "file": "src/main.ts",
            "line": 42
          },
          "meta": { "salience": 1.0 }
        }
      ]
    },
    {
      "id": "ctx",
      "type": "context",
      "properties": {
        "git_branch": "feature/slop",
        "git_dirty": true,
        "extensions_active": 24
      }
    }
  ]
}
```
