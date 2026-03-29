---
title: "@slop-ai/core"
description: API reference for the SLOP core client library
---

The core package provides `createSlop` and all types needed to add SLOP to any JavaScript application.

```bash
bun add @slop-ai/core
```

## `createSlop(options)`

Creates a SLOP client instance. Call once, import anywhere.

```ts
import { createSlop } from "@slop-ai/core";

const slop = createSlop({
  id: "my-app",
  name: "My App",
  schema: { ... },  // optional — enables typed paths
});
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique app identifier |
| `name` | `string` | Yes | Human-readable app name |
| `schema` | `object` | No | Typed schema for compile-time path validation |

### Returns: `SlopClient`

## `client.register(path, descriptor)`

Add or update a node in the SLOP tree.

```ts
slop.register("inbox/messages", {
  type: "collection",
  props: { count: messages.length },
  items: messages.map(m => ({
    id: m.id,
    props: { from: m.from, subject: m.subject },
    actions: {
      archive: () => archiveMessage(m.id),
      delete: { handler: () => deleteMessage(m.id), dangerous: true },
    },
  })),
});
```

Calling `register` with the same path replaces the previous descriptor. The client diffs the tree and pushes patches to consumers.

### Path syntax

Paths encode tree hierarchy using `/` separators:
- `"inbox"` — top-level node
- `"inbox/messages"` — child of inbox
- `"inbox/messages"` registered separately from `"inbox"` — automatically nested

## `client.unregister(path, options?)`

Remove a node from the tree.

```ts
slop.unregister("inbox/messages");

// Remove node and all descendants
slop.unregister("inbox", { recursive: true });
```

## `client.scope(path, descriptor?)`

Create a scoped client that prefixes all paths. Useful for reusable components.

```ts
const inbox = slop.scope("inbox", { type: "view" });
inbox.register("messages", { ... });  // registers at "inbox/messages"
inbox.register("unread", { ... });    // registers at "inbox/unread"
```

Scoped clients can nest:
```ts
const workspace = slop.scope("workspace");
const projects = workspace.scope("projects");
projects.register("board", { ... });  // registers at "workspace/projects/board"
```

## `client.flush()`

Force an immediate tree rebuild, skipping the microtask debounce.

## `client.stop()`

Disconnect from transport and stop the client.

## Node Descriptor

The object passed to `register`. Uses developer-friendly names that the library translates to SLOP protocol format internally.

```ts
interface NodeDescriptor {
  type: string;                    // "collection", "item", "view", "status", "group", "form", etc.
  props?: Record<string, unknown>; // Exposed properties (→ SlopNode.properties)
  items?: ItemDescriptor[];        // Children with type "item" (→ SlopNode.children)
  children?: Record<string, NodeDescriptor>;  // Named children (→ SlopNode.children)
  actions?: Record<string, Action>;           // Affordances (→ SlopNode.affordances)
  meta?: { salience?: number; summary?: string; ... };  // Attention hints
}
```

## Actions

Three forms:

```ts
actions: {
  // Simple callback — no params
  toggle: () => togglePin(id),

  // With options
  delete: {
    handler: () => remove(id),
    dangerous: true,
  },

  // With typed params
  edit: {
    params: { title: "string", content: "string" },
    handler: ({ title, content }) => update(id, title, content),
    label: "Edit Note",
  },
}
```

## Typed Schema

Optional. Enables compile-time path validation with TypeScript.

```ts
const schema = {
  inbox: {
    messages: "collection",
    compose: "form",
  },
  settings: {
    account: "group",
  },
} as const;

const slop = createSlop({ id: "mail", name: "Mail", schema });

slop.register("inbox/messages", { ... });  // ✓ valid
slop.register("inbox/foo", { ... });       // ✗ compile error
```
