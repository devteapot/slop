# State Stores Blueprint: `todo-store`

This example demonstrates how SLOP can project existing TypeScript state stores without requiring a framework-specific adapter. Every implementation exposes the same todo list tree through `exposeStore()`.

## What this demonstrates

| SLOP feature | How it is used |
|---|---|
| Store adapters | Zustand, Redux Toolkit, Jotai, MobX, and Valtio are adapted to `getState()` plus `subscribe()` |
| Semantic projection | Internal state is converted into a small SLOP tree instead of dumping raw store data |
| Affordances | Store operations are exposed as `create`, `toggle`, and `clear_done` actions |
| Cleanup | Disposing the binding unregisters the exposed tree recursively |

## App Behavior

The example is a todo list with three operations:

1. Create a todo with a title.
2. Toggle a todo between open and done.
3. Clear all done todos.

The example intentionally runs without a browser transport so it can be tested in Bun and reused as copyable SDK integration code.

## SLOP Tree

```
[root] <library>-todos
  |
  `-- [collection] todos
        properties: { count: number, done: number, open: number }
        affordances: [
          create(title: string),
          clear_done() { dangerous: true },
        ]
        |
        `-- [item] todo-1
              properties: { title: string, done: boolean }
              affordances: [
                toggle(),
              ]
```

## Implementation Constraints

- Use `@slop-ai/client`.
- Use `createSlop({ transports: [] })` so the examples run in tests without `window`.
- Keep the library-specific code limited to adapting state reads, subscriptions, and mutations.
- Keep the projected SLOP descriptor identical across state libraries.
