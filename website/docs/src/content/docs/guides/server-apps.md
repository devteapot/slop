---
title: "Server & Native Apps"
description: "Add SLOP to server-backed apps, desktop helpers, daemons, and CLI tools"
---
Use a server-side SDK when your app owns the authoritative state outside the browser. These providers expose a public WebSocket, Unix socket, or stdio endpoint directly instead of relying on the browser extension.

## Choose the right package

| Runtime | Package | Best fit |
| --- | --- | --- |
| TypeScript / Node / Bun | `@slop-ai/server` | services, local desktop helpers, CLI tools |
| TanStack Start | `@slop-ai/tanstack-start` | full-stack React apps with mounted UI state |
| Python | `slop-ai` | FastAPI, services, local tools |
| Go | `slop-ai` | `net/http` services, daemons, CLI tools |
| Rust | `slop-ai` | Axum apps, daemons, CLI tools |

## TypeScript example

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

const server = createServer(app);
attachSlop(slop, server, { path: "/slop" });
server.listen(3000);
```

## Local-native transports

When the provider lives on the same machine as the consumer, Unix socket or stdio transports are a good fit:

### TypeScript

```ts
import { listenUnix } from "@slop-ai/server/unix";

listenUnix(slop, "/tmp/slop/my-app.sock", { register: true });
```

### Python

```python
from slop_ai.transports.unix import listen

server = await listen(slop, "/tmp/slop/my-app.sock", register=True)
```

### Go

```go
slop.ListenUnix(ctx, server, "/tmp/slop/my-app.sock", slop.WithDiscovery(true))
```

### Rust

```rust
let handle = slop_ai::transport::unix::listen(&slop, "/tmp/slop/my-app.sock").await?;
```

## Discovery

Server-backed web apps should expose `/.well-known/slop` alongside the WebSocket endpoint.

Local apps can register a descriptor in `~/.slop/providers/` so the desktop app, the inspector, and other consumers can discover them automatically.

## Related pages

- [Full-stack apps](/guides/advanced/full-stack) — merging server + browser UI into one provider
- [Server provider API](/api/server)
- [TanStack Start guide](/guides/tanstack-start)
- [Consumer guide](/guides/consumer)
