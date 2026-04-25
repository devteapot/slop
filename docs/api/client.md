# @slop-ai/client

`@slop-ai/client` is the main entry point for browser applications. It creates a provider, manages browser transports, and publishes descriptors registered by your framework adapter or vanilla code.

```bash
bun add @slop-ai/client
```

## `createSlop(options)`

```ts
import { createSlop } from "@slop-ai/client";

const slop = createSlop({
  id: "my-app",
  name: "My App",
});
```

### Important options

| Option | Type | Description |
| --- | --- | --- |
| `id` | `string` | unique provider id |
| `name` | `string` | human-readable provider name |
| `schema` | `object` | optional typed schema for path inference |
| `transports` | `("postmessage" \| "websocket")[]` | explicit transport list |
| `desktopUrl` | `boolean \| string` | convenience alias for WebSocket publishing |
| `websocketUrl` | `boolean \| string` | enable a WebSocket transport and optionally provide the URL |
| `postmessageDiscover` | `boolean` | control `<meta name="slop">` discovery for postMessage |
| `websocketDiscover` | `boolean` | control discovery metadata for WebSocket |

## Instance methods

Once created, the returned client exposes the provider API you use from adapters and direct integrations:

- `register(path, descriptor)`
- `unregister(path)`
- `scope(prefix)`
- `flush()`
- `stop()`
- `asyncAction(...)`

## Store helper

`@slop-ai/client` re-exports `exposeStore()` from `@slop-ai/core` so browser apps can bind Zustand, Redux Toolkit, Jotai, MobX, Valtio, or any `getState()` / `subscribe()` store without an additional package.

```ts
import { createSlop, exposeStore } from "@slop-ai/client";

const slop = createSlop({ id: "todos", name: "Todos" });

exposeStore(slop, "todos", todoStore, (state) => ({
  type: "collection",
  props: { count: state.todos.length },
}));
```

The runnable examples in `examples/state-stores/typescript` show the adapter shape for each major library.

## Transport helpers

The package also exports:

- `createPostMessageTransport()`
- `createWebSocketTransport()`

Use these if you need manual transport composition instead of the defaults from `createSlop()`.

## Example

```ts
const slop = createSlop({
  id: "notes-app",
  name: "Notes App",
  transports: ["postmessage", "websocket"],
  websocketUrl: true,
});

slop.register("notes", {
  type: "collection",
  props: { count: notes.length },
  items: notes.map((note) => ({
    id: note.id,
    props: { title: note.title, pinned: note.pinned },
  })),
});
```

## Related pages

- [Vanilla guide](/guides/vanilla)
- [State stores guide](/guides/state-stores)
- [React guide](/guides/react)
- [Vue guide](/guides/vue)
- [Core helpers](/api/core)
