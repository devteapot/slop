---
title: "@slop-ai/core"
description: "Shared SLOP descriptor types, helpers, and tree utilities"
---
`@slop-ai/core` is the shared package underneath the browser, server, and adapter SDKs. It does not create a transport or start a provider by itself. Instead, it exports the descriptor types, helper utilities, and tree-processing primitives used everywhere else.

```bash
bun add @slop-ai/core
```

## What it exports

- descriptor and wire types such as `NodeDescriptor`, `ItemDescriptor`, `SlopNode`, and `Affordance`
- helper utilities such as `pick()`, `omit()`, `action()`, and `exposeStore()`
- provider base internals used by `@slop-ai/client` and `@slop-ai/server`
- advanced tree helpers such as `assembleTree()`, `diffNodes()`, `prepareTree()`, and `autoCompact()`

```ts
import { action, pick } from "@slop-ai/core";

const noteDescriptor = {
  type: "item",
  props: pick(note, ["title", "done", "priority"]),
  actions: {
    rename: action({ title: "string" }, ({ title }) => renameNote(note.id, title)),
    delete: action(() => deleteNote(note.id), { dangerous: true }),
  },
};
```

## Store Bindings

`exposeStore()` binds any store with `getState()` and `subscribe()` to a SLOP node. It is intended for Zustand, Redux Toolkit, Jotai, MobX, Valtio, and similar state stores.

```ts
import { exposeStore } from "@slop-ai/core";

const dispose = exposeStore(slop, "todos", todoStore, (state) => ({
  type: "collection",
  props: { count: state.todos.length },
  items: state.todos.map((todo) => ({
    id: todo.id,
    props: { title: todo.title, done: todo.done },
  })),
}));

dispose();
```

The tested TypeScript examples in `examples/state-stores/typescript` show how to adapt stores that already match this shape and stores that need a small wrapper.

## Important boundary

`createSlop()` is exported by [`@slop-ai/client`](/api/client), not by `@slop-ai/core`.

`createSlopServer()` is exported by [`@slop-ai/server`](/api/server), not by `@slop-ai/core`.

## Node Descriptor

This is the shape every adapter eventually feeds into the protocol layer.

```ts
interface NodeDescriptor {
  type: string;
  props?: Record<string, unknown>;
  items?: ItemDescriptor[];
  children?: Record<string, NodeDescriptor>;
  actions?: Record<string, Action>;
  meta?: { salience?: number; summary?: string };
}
```

## Actions

`action()` helps you keep parameter typing close to the handler:

```ts
import { action } from "@slop-ai/core";

actions: {
  edit: action({ title: "string", content: "string" }, ({ title, content }) => {
    updateNote(id, title, content);
  }),
  delete: action(() => remove(id), { dangerous: true }),
}
```

## Scaling helpers

The package also exports utilities for preparing large trees before they are sent to consumers:

- `prepareTree()`
- `truncateTree()`
- `filterTree()`
- `autoCompact()`
- `countNodes()`

## Related pages

- [`@slop-ai/client`](/api/client)
- [`@slop-ai/server`](/api/server)
- [State stores guide](/guides/state-stores)
- [Protocol overview](/spec/core/overview)
