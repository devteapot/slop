# `@slop-ai/server`

Server-side and native-app SLOP provider for Node.js and Bun.

Use this package when your app owns the authoritative state on the server, in a desktop process, or inside a CLI tool.

## Install

```bash
bun add @slop-ai/server
```

## Quick start

```ts
import { createServer } from "node:http";
import { createSlopServer } from "@slop-ai/server";
import { attachSlop } from "@slop-ai/server/node";

const slop = createSlopServer({ id: "my-app", name: "My App" });

slop.register("todos", () => ({
  type: "collection",
  props: { count: getTodos().length },
  items: getTodos().map((todo) => ({
    id: todo.id,
    props: { title: todo.title, done: todo.done },
  })),
}));

const server = createServer();
attachSlop(slop, server, { path: "/slop" });
server.listen(3000);
```

## Transport exports

- `@slop-ai/server/node` for Node HTTP servers
- `@slop-ai/server/bun` for `Bun.serve`
- `@slop-ai/server/unix` for local Unix socket discovery
- `@slop-ai/server/stdio` for CLI and subprocess transports
- `@slop-ai/server/nitro` for Nitro WebSocket handlers
- `@slop-ai/server/vite` for Vite dev-server attachment

## Native and CLI example

```ts
import { createSlopServer } from "@slop-ai/server";
import { listenUnix } from "@slop-ai/server/unix";

const slop = createSlopServer({ id: "my-cli", name: "My CLI" });
slop.register("status", () => ({ type: "status", props: { ready: true } }));

listenUnix(slop, "/tmp/slop/my-cli.sock", { register: true });
```

## Documentation

- API reference: https://docs.slopai.dev/api/server
- Server and native apps guide: https://docs.slopai.dev/guides/server-apps
- TanStack Start adapter: https://docs.slopai.dev/api/tanstack-start
