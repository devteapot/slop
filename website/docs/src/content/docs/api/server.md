---
title: "@slop-ai/server"
---

The server package lets you expose application state and actions to AI consumers over SLOP. It handles tree assembly, diffing, patch broadcasting, and action dispatch. Pair it with a transport adapter to serve over WebSocket, Unix socket, or stdio.

```bash
bun add @slop-ai/server
```

## `createSlopServer(options)`

Creates a SLOP server instance. Call once, import anywhere.

```ts
import { createSlopServer } from "@slop-ai/server";

const slop = createSlopServer({
  id: "my-app",
  name: "My App",
  schema: { ... },  // optional — enables typed paths
  maxDepth: 5,      // optional — truncate tree beyond this depth
  maxNodes: 200,    // optional — auto-compact to fit node budget
});
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique app identifier |
| `name` | `string` | Yes | Human-readable app name |
| `schema` | `object` | No | Typed schema for compile-time path validation |
| `maxDepth` | `number` | No | Truncate tree beyond this depth |
| `maxNodes` | `number` | No | Auto-compact tree to fit node budget |

### Returns: `SlopServer`

## `slop.register(path, descriptorFn)`

Register a node with a descriptor function. The function is re-evaluated on every refresh cycle, so it always returns the latest state.

```ts
slop.register("todos", () => ({
  type: "collection",
  props: { count: getTodos().length },
  items: getTodos().map(t => ({
    id: t.id,
    props: { title: t.title, done: t.done },
    actions: {
      toggle: () => toggleTodo(t.id),
      delete: { handler: () => deleteTodo(t.id), dangerous: true },
    },
  })),
}));
```

Also accepts a static `NodeDescriptor` for nodes that never change:

```ts
slop.register("about", {
  type: "item",
  props: { version: "1.0.0", name: "My App" },
});
```

Calling `register` with the same path replaces the previous descriptor.

### Why descriptor functions?

On the server there is no framework reactivity (no signals, no proxies). The server cannot know when your data changes. Instead, you wrap your descriptor in a function and the server calls it to snapshot the current state. This happens at three points:

1. **Initial registration** -- the function runs immediately to build the first tree.
2. **After invoke** -- when a consumer triggers an action, the server auto-refreshes to capture side effects.
3. **Explicit `refresh()`** -- you call `slop.refresh()` after external mutations (REST API, database webhook, etc.).

## `slop.unregister(path)`

Remove a node from the tree.

```ts
slop.unregister("todos");
```

## `slop.scope(prefix)`

Create a scoped server that prefixes all paths. Useful for modular registration.

```ts
const admin = slop.scope("admin");
admin.register("users", () => ({ ... }));      // registers at "admin/users"
admin.register("settings", () => ({ ... }));   // registers at "admin/settings"
```

Scoped servers can nest:

```ts
const workspace = slop.scope("workspace");
const projects = workspace.scope("projects");
projects.register("board", () => ({ ... }));   // registers at "workspace/projects/board"
```

## `slop.refresh()`

Re-evaluate all descriptor functions, diff the tree, and broadcast patches to connected consumers. Call this after mutations that happen outside of SLOP.

```ts
// After a REST endpoint mutates data
app.post("/api/todos", (req, res) => {
  createTodo(req.body);
  slop.refresh();  // consumers see the new todo immediately
  res.json({ ok: true });
});
```

## `slop.onChange(callback)`

Register a listener that fires after every tree rebuild. Returns an unsubscribe function.

```ts
const unsub = slop.onChange(() => {
  console.log("Tree changed, version:", slop.getVersion());
});

// Later
unsub();
```

## `slop.getVersion()`

Get the current tree version number. Increments on every successful diff.

```ts
const v = slop.getVersion(); // 1, 2, 3, ...
```

## `slop.getTree()`

Get the current tree as a `SlopNode`. Useful for inspection and testing.

```ts
const tree = slop.getTree();
console.log(JSON.stringify(tree, null, 2));
```

## `slop.stop()`

Graceful shutdown. Closes all connections and clears subscriptions.

```ts
process.on("SIGTERM", () => {
  slop.stop();
  process.exit(0);
});
```

## Transport Adapters

The server instance is transport-agnostic. Pick the adapter that matches your runtime.

### `attachSlop` -- Node.js HTTP

```ts
import { createServer } from "node:http";
import { createSlopServer } from "@slop-ai/server";
import { attachSlop } from "@slop-ai/server/node";

const slop = createSlopServer({ id: "app", name: "App" });
const server = createServer();

attachSlop(slop, server, { path: "/slop", discovery: true });
server.listen(3000);
```

Attaches a WebSocket endpoint to an existing `http.Server`. Serves `/.well-known/slop` discovery by default.

| Option | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | `"/slop"` | WebSocket path |
| `discovery` | `boolean` | `true` | Serve `/.well-known/slop` endpoint |

### `bunHandler` -- Bun

```ts
import { createSlopServer } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";

const slop = createSlopServer({ id: "app", name: "App" });
const handler = bunHandler(slop, { path: "/slop" });

Bun.serve({
  fetch(req, server) {
    const resp = handler.fetch(req, server);
    if (resp) return resp;
    return new Response("Hello");
  },
  websocket: handler.websocket,
});
```

Returns `{ fetch, websocket }` to plug into `Bun.serve`.

### `listenUnix` -- Unix domain socket

```ts
import { listenUnix } from "@slop-ai/server/unix";

const handle = listenUnix(slop, "/tmp/slop/my-app.sock", { register: true });

// Later
handle.close();
```

Communicates via NDJSON over a Unix socket. Set `register: true` to write a discovery file to `~/.slop/providers/`.

### `listenStdio` -- stdin/stdout

```ts
import { listenStdio } from "@slop-ai/server/stdio";

const handle = listenStdio(slop);
```

Single-consumer NDJSON transport over stdin/stdout. Ideal for CLI tools and subprocess-based integrations.

### `nitroHandler` -- Nuxt/Nitro

```ts
// server/routes/slop.ts
import { nitroHandler } from "@slop-ai/server/nitro";

export default nitroHandler(slop);
```

Returns a Nitro WebSocket handler. Requires `nitro: { experimental: { websocket: true } }` in `nuxt.config`.

### `slopPlugin` -- Vite

```ts
// vite.config.ts
import { slopPlugin } from "@slop-ai/server/vite";

export default {
  plugins: [sveltekit(), slopPlugin(slop, { path: "/slop" })],
};
```

Vite plugin that attaches a SLOP WebSocket endpoint to the dev server. Uses the Node.js transport under the hood.
