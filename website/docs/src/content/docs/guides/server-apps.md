---
title: Server & Native Apps
description: Add SLOP to server-backed web apps, Electron apps, and CLI tools
---

Web SPAs use `@slop-ai/client` with postMessage transport (the browser extension discovers them via `<meta>` tag). Server-backed web apps, Electron apps, and CLI tools use `@slop-ai/server` with **different transports** that connect directly. In fullstack adapters, the browser UI can connect back to that server and be mounted under the conventional `ui` subtree, so the public provider is still the server WebSocket.

:::tip[Using Next.js, Nuxt, or SvelteKit?]
Meta-framework adapters (`@slop-ai/next`, `@slop-ai/nuxt`, `@slop-ai/sveltekit`) handle server setup, UI sync, and state composition automatically. They wrap `@slop-ai/server` with framework-specific integration so you don't need to wire anything manually. See [Web Integration spec](/spec/integrations/web) for details.

This guide covers the lower-level `@slop-ai/server` API — useful for Express, Fastify, Hono, Electron, Tauri, CLI tools, or when you need full control.
:::

## Transport comparison

### JavaScript / TypeScript

| App type | Package | Transport | Discovery |
|---|---|---|---|
| **SPA** (React, Vue, etc.) | `@slop-ai/client` | postMessage | `<meta name="slop">` tag |
| **Server-backed web app** | `@slop-ai/server` | WebSocket | `/.well-known/slop` endpoint |
| **Native app** (Electron, Tauri) | `@slop-ai/server` | Unix socket | `~/.slop/providers/*.json` |
| **CLI tool** | `@slop-ai/server` | Unix socket or stdio | `~/.slop/providers/*.json` |

### Python

| App type | Package | Transport | Discovery |
|---|---|---|---|
| **FastAPI / Starlette** | `slop-ai` | ASGI WebSocket | `/.well-known/slop` endpoint |
| **Backend service** | `slop-ai` | WebSocket | `/.well-known/slop` endpoint |
| **Desktop app** (tkinter, PyQt) | `slop-ai` | Unix socket | `~/.slop/providers/*.json` |
| **CLI tool** | `slop-ai` | Unix socket or stdio | `~/.slop/providers/*.json` |

### Go

| App type | Package | Transport | Discovery |
|---|---|---|---|
| **HTTP service** (net/http, chi, gin) | `slop-ai` | WebSocket via `server.Mount(mux)` | `/.well-known/slop` endpoint |
| **Backend service** | `slop-ai` | WebSocket | `/.well-known/slop` endpoint |
| **CLI tool** | `slop-ai` | Unix socket or stdio | `~/.slop/providers/*.json` |
| **Daemon / agent** | `slop-ai` | Unix socket | `~/.slop/providers/*.json` |

### Rust

| App type | Package | Transport | Discovery |
|---|---|---|---|
| **axum web app** | `slop-ai` | axum WebSocket | `/.well-known/slop` endpoint |
| **Backend service** | `slop-ai` | WebSocket (tokio-tungstenite) | `/.well-known/slop` endpoint |
| **CLI tool** | `slop-ai` | Unix socket or stdio | `~/.slop/providers/*.json` |
| **Daemon / embedded** | `slop-ai` | Unix socket | `~/.slop/providers/*.json` |

**The key difference:** SPAs run inside the browser — the only way to reach them is through the extension (postMessage). Server and native apps run as processes — they open a socket that anything can connect to directly.

## Quick start

Install `@slop-ai/server`:

```bash
bun add @slop-ai/server
```

Create a SLOP server and register your state:

```ts
import { createSlopServer } from "@slop-ai/server";

const slop = createSlopServer({ id: "my-app", name: "My App" });

slop.register("todos", () => ({
  type: "collection",
  props: { count: getTodos().length },
  actions: {
    add: {
      params: { title: "string" },
      handler: (params) => addTodo(params.title as string),
    },
  },
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

Then attach a transport:

```ts
import { attachSlop } from "@slop-ai/server/node";
attachSlop(slop, httpServer);
```

That's it. The same `register()` API and descriptor format as `@slop-ai/client` — `props`, `actions`, `items`.

## Descriptor functions

On the server, `register()` accepts a **function** that returns a descriptor. The server re-evaluates it:

1. **After every successful invoke** — auto-refresh, since actions mutate state
2. **On explicit `slop.refresh()`** — for mutations outside SLOP (REST API, etc.)

```ts
// REST endpoint — mutation happens outside SLOP
app.post("/api/todos", (req, res) => {
  addTodo(req.body.title);
  slop.refresh();  // re-evaluate descriptors, diff, broadcast
  res.json({ ok: true });
});
```

## WebSocket (server-backed web apps)

Best for: web apps with a backend (Next.js, Express, Bun, etc.).

### Node.js / Express

```ts
import { createServer } from "node:http";
import { attachSlop } from "@slop-ai/server/node";

const server = createServer(app);
attachSlop(slop, server, { path: "/slop" });
server.listen(3000);
```

`attachSlop` handles WebSocket upgrades at the specified path and automatically serves `/.well-known/slop` for discovery.

### Next.js

```ts
// server.ts
import next from "next";
import { createServer } from "node:http";
import { attachSlop } from "@slop-ai/server/node";
import { slop } from "./lib/slop";

const app = next({ dev: true });
await app.prepare();
const server = createServer((req, res) => app.getRequestHandler()(req, res));
attachSlop(slop, server, { path: "/api/slop" });
server.listen(3000);
```

### Nuxt (Nitro)

```ts
// server/routes/slop.ts
import { nitroHandler } from "@slop-ai/server/nitro";
import { slop } from "../utils/slop";

export default defineWebSocketHandler(nitroHandler(slop));
```

Requires `nitro: { experimental: { websocket: true } }` in nuxt.config.

### SvelteKit

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { slopPlugin } from "@slop-ai/server/vite";
import { slop } from "./src/lib/server/slop";

export default { plugins: [sveltekit(), slopPlugin(slop)] };
```

## Unix socket (native apps)

Best for: Electron apps, Tauri apps, background daemons, CLI tools running locally.

```ts
import { createSlopServer } from "@slop-ai/server";
import { listenUnix } from "@slop-ai/server/unix";

const slop = createSlopServer({
  id: "clipboard-manager",
  name: "Clipboard Manager",
});

slop.register("entries", () => ({
  type: "collection",
  items: getEntries().map(e => ({
    id: e.id,
    props: { preview: e.preview, favorite: e.favorite },
    actions: {
      copy: () => copyToClipboard(e.id),
      favorite: () => toggleFavorite(e.id),
      delete: { handler: () => deleteEntry(e.id), dangerous: true },
    },
  })),
}));

listenUnix(slop, "/tmp/slop/clipboard.sock", { register: true });
```

When `register: true`, the provider writes a JSON descriptor to `~/.slop/providers/clipboard-manager.json`. The SLOP desktop app watches this directory and automatically discovers the provider.

## Unix socket (CLI tools)

Best for: CLI tools that want to expose state to AI agents while keeping stdin/stdout free for human interaction.

```ts
import { createSlopServer } from "@slop-ai/server";
import { listenUnix } from "@slop-ai/server/unix";

const slop = createSlopServer({ id: "my-cli", name: "My CLI Tool" });
slop.register("status", () => ({ type: "status", props: { ... } }));

const handle = listenUnix(slop, "/tmp/slop/my-cli.sock", { register: true });
console.log("Listening on /tmp/slop/my-cli.sock");
// stdout is free for human-readable output
// AI consumers connect via the Unix socket
```

## Multiple transports

A server can expose multiple transports simultaneously. All share the same state:

```ts
import { attachSlop } from "@slop-ai/server/node";
import { listenUnix } from "@slop-ai/server/unix";

attachSlop(slop, httpServer);   // remote consumers via WebSocket
listenUnix(slop);               // local agents via Unix socket
```

## When to use which

| Scenario | Use |
|---|---|
| React/Vue/Solid SPA, no server | `@slop-ai/client` + postMessage |
| Web app with a JS backend | `@slop-ai/server` + `attachSlop` |
| Next.js / Nuxt / SvelteKit | `@slop-ai/server` + framework helper |
| FastAPI / Starlette | `slop-ai` + `SlopMiddleware` |
| Python backend service | `slop-ai` + WebSocket transport |
| Python CLI tool | `slop-ai` + Unix socket transport |
| Python desktop app (tkinter, PyQt) | `slop-ai` + Unix socket |
| Go HTTP service | `slop-ai` + `server.Mount(mux)` |
| Go CLI tool | `slop-ai` + `ListenUnix` |
| Go daemon | `slop-ai` + `ListenUnix` |
| Rust axum web app | `slop-ai` + `slop_router` |
| Rust CLI tool | `slop-ai` + Unix socket transport |
| Electron app | `@slop-ai/server` + `listenUnix` |
| Tauri app | `@slop-ai/server` + `listenUnix` |
| JS CLI tool | `@slop-ai/server` + `listenUnix` |
| Background daemon | `@slop-ai/server` + `listenUnix` |

## Examples

See the `examples/` directory for complete working apps:

- `website/demo/` — Interactive three-panel demo: e-commerce store + AI agent + live state tree (`bun demo`)
- `examples/spa/notes/` — React SPA + postMessage
- `examples/full-stack/tanstack-start/` — TanStack Start fullstack + WebSocket
- `examples/full-stack/python-react/` — Python FastAPI + React SPA, cross-SDK integration
