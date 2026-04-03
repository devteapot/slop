---
title: "@slop-ai/server"
description: "Server-side SLOP provider for Node.js, Bun, local tools, and native apps"
---
The server package lets you expose application state and actions to AI consumers over SLOP. It handles tree assembly, diffing, patch broadcasting, and action dispatch. Pair it with a transport adapter to serve over WebSocket, Unix socket, or stdio.

```bash
bun add @slop-ai/server
```

## `createSlopServer(options)`

```ts
import { createSlopServer } from "@slop-ai/server";

const slop = createSlopServer({
  id: "my-app",
  name: "My App",
});
```

### Common methods

- `register(path, descriptorOrFn)`
- `unregister(path)`
- `scope(prefix)`
- `refresh()`
- `onChange(listener)`
- `getVersion()`
- `getTree()`
- `stop()`

## Descriptor functions

Server registrations can be static objects or functions. Use descriptor functions when the provider needs to re-read changing application state.

```ts
slop.register("todos", () => ({
  type: "collection",
  props: { count: getTodos().length },
  items: getTodos().map((todo) => ({
    id: todo.id,
    props: { title: todo.title, done: todo.done },
  })),
}));
```

Call `slop.refresh()` after mutations that happen outside SLOP action handlers.

## Transport subpaths

The server instance is transport-agnostic. Pick the runtime-specific export that matches your app:

- `@slop-ai/server/node`
- `@slop-ai/server/bun`
- `@slop-ai/server/unix`
- `@slop-ai/server/stdio`
- `@slop-ai/server/nitro`
- `@slop-ai/server/vite`

### Node example

```ts
import { createServer } from "node:http";
import { attachSlop } from "@slop-ai/server/node";

const server = createServer(app);
attachSlop(slop, server, { path: "/slop" });
server.listen(3000);
```

### Unix socket example

```ts
import { listenUnix } from "@slop-ai/server/unix";

listenUnix(slop, "/tmp/slop/my-app.sock", { register: true });
```

## Related pages

- [Server and native apps guide](/guides/server-apps)
- [TanStack Start adapter](/api/tanstack-start)
- [Consumer SDK](/api/consumer)
