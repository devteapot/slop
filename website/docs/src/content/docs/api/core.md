---
title: "@slop-ai/core"
description: API reference for the SLOP core client library
---

The core package is the shared engine that powers all SLOP integrations. It exports types, helpers (`action`, `pick`, `omit`, `NodeDescriptor`), and internal machinery. The `createSlop` function has moved to `@slop-ai/client`.

```bash
bun add @slop-ai/core          # types and helpers only
bun add @slop-ai/client         # createSlop + full client (depends on core)
```

## `createSlop(options)`

Creates a SLOP client instance. Call once, import anywhere. **Exported from `@slop-ai/client`** (not `@slop-ai/core`).

```ts
import { createSlop } from "@slop-ai/client";

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

## Helpers

### `pick(obj, keys)`

Select specific fields from an object for use in `props`:

```ts
import { pick } from "@slop-ai/core";

items: notes.map(n => ({
  id: n.id,
  props: pick(n, ["title", "done", "created"]),
}))

// Or just pass the object directly for all fields:
props: note
```

### `omit(obj, keys)`

Exclude specific fields:

```ts
import { omit } from "@slop-ai/core";

props: omit(note, ["_id", "__typename", "internalCache"])
```

### `action(params, handler, options?)`

Create an action with typed handler params — no `as string` casts needed:

```ts
import { action } from "@slop-ai/core";

actions: {
  edit: action({ title: "string", content: "string" }, ({ title, content }) => {
    // title: string, content: string — inferred from params declaration
    updateNote(id, title, content);
  }),

  // With options
  delete: action(() => remove(id), { dangerous: true }),
}
```

Supported param types: `"string"`, `"number"`, `"boolean"`, or `{ type: "string", enum: [...] }`.

### `client.asyncAction(params, fn, options?)`

Create an async action that runs in the background with automatic progress tracking:

```ts
actions: {
  deploy: slop.asyncAction(
    { env: "string" },
    async ({ env }, task) => {
      task.update(0, "Building...");
      await build(env);
      task.update(0.5, "Running tests...");
      await runTests();
      task.update(0.9, "Deploying...");
      await deploy(env);
      return { url: "https://..." };  // auto-completes the task
    },
    { label: "Deploy", cancelable: true }
  ),
}
```

The helper automatically:
- Returns `status: "accepted"` immediately (doesn't block the AI)
- Creates a task status node in the tree at `tasks/{taskId}`
- Updates the node as `task.update(progress, message)` is called
- Marks the task as "done" when the function returns
- Marks the task as "failed" if the function throws
- Adds a `cancel` affordance if `cancelable: true` (with AbortSignal)
- Auto-removes completed tasks after 30 seconds

The `task` object:

| Property | Type | Description |
|---|---|---|
| `task.id` | `string` | Auto-generated task ID |
| `task.signal` | `AbortSignal` | Fires on cancel (if cancelable) |
| `task.update(progress, message)` | `function` | Update progress (0–1) and status message |

## Scaling Options

### `maxDepth`

Truncate the tree beyond a depth limit. Nodes beyond the limit become stubs with `meta.total_children`.

```ts
const slop = createSlop({ id: "app", name: "App", maxDepth: 3 });
```

### `maxNodes`

Auto-compact the tree to fit a node budget. Low-salience, deep, large subtrees are collapsed first. Root children are never collapsed.

```ts
const slop = createSlop({ id: "app", name: "App", maxNodes: 200 });
```

### `summary`

Add a natural language summary to any node. Used when the node is collapsed (by depth or budget limiting):

```ts
slop.register("cart", {
  type: "view",
  summary: "3 items, $127.49 — wireless mouse, USB-C cable, monitor stand",
});
```

### `window`

Expose only a slice of a large collection:

```ts
slop.register("messages", {
  type: "collection",
  summary: "500 messages, 12 unread",
  window: {
    items: visibleMessages.map(m => ({ id: m.id, props: { ... } })),
    total: allMessages.length,
    offset: scrollPosition,
  },
});
```

### `contentRef`

Reference large content (files, documents) by pointer instead of inlining:

```ts
slop.register("editor/main-ts", {
  type: "document",
  props: { title: "main.ts", language: "typescript" },
  contentRef: {
    type: "text",
    mime: "text/typescript",
    size: 12400,
    summary: "TypeScript module, exports SLOP client",
    preview: "import { createSlop }...",
  },
  actions: {
    read_content: () => ({ content: file.readSync(), encoding: "utf-8" }),
  },
});
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
