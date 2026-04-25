# TypeScript State Store Examples

Runnable examples for exposing popular TypeScript state stores through SLOP with `exposeStore()`.

The examples all project the same todo list tree:

- `src/zustand.ts` adapts a Zustand vanilla store.
- `src/redux-toolkit.ts` adapts a Redux Toolkit store.
- `src/jotai.ts` adapts Jotai vanilla atoms through a small `getState()`/`subscribe()` wrapper.
- `src/mobx.ts` adapts a MobX observable model with `reaction()`.
- `src/valtio.ts` adapts a Valtio proxy with `snapshot()` and `subscribe()`.

Run the examples as tests:

```sh
bun test
```

Type-check the package:

```sh
bun run build
```

Each example uses `createSlop({ transports: [] })` so it can run in Bun without browser globals. In a browser app, omit `transports` or pass your normal transport options.

