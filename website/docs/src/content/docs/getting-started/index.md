---
title: Quick Start
description: Add SLOP to your app in 5 minutes
---

SLOP lets AI observe and interact with your application's state. This guide shows you how to add it to a React app. The same pattern works with Vue, Solid, Angular, Svelte, or vanilla JS.

## Install

```bash
bun add @slop-ai/client @slop-ai/react
# or: npm install @slop-ai/client @slop-ai/react
```

## Create the SLOP client

Create a file that initializes the client. You'll import this from any component that needs to expose state.

```ts
// slop.ts
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({ id: "my-app", name: "My App" });
```

That's it — 3 lines. The client handles transport, diffing, and invocation routing internally.

## Register state in a component

Use the `useSlop` hook to expose a component's state to AI. Place it near your state declarations, not in the JSX.

```tsx
import { useState } from "react";
import { useSlop } from "@slop-ai/react";
import { pick, action } from "@slop-ai/core";
import { slop } from "./slop";

function TodoList() {
  const [todos, setTodos] = useState([
    { id: "1", title: "Read the SLOP spec", done: true },
    { id: "2", title: "Build the MVP", done: false },
  ]);

  // Expose state to AI — JSX stays SLOP-free
  useSlop(slop, "todos", {
    type: "collection",
    props: { count: todos.length },
    actions: {
      create: action({ title: "string" }, ({ title }) => {
        setTodos(prev => [...prev, { id: Date.now().toString(), title, done: false }]);
      }),
    },
    items: todos.map(todo => ({
      id: todo.id,
      props: pick(todo, ["title", "done"]),
      actions: {
        toggle: () => setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done: !t.done } : t)),
        delete: action(() => setTodos(prev => prev.filter(t => t.id !== todo.id)), { dangerous: true }),
      },
    })),
  });

  return (
    <ul>
      {todos.map(t => <li key={t.id}>{t.title} {t.done ? "✓" : ""}</li>)}
    </ul>
  );
}
```

## What happens next

When this component renders:

1. `@slop-ai/core` assembles a SLOP state tree from all registered nodes
2. It injects a `<meta name="slop" content="postmessage">` tag into the page
3. The SLOP browser extension discovers it and connects. Desktop clients reach in-browser providers through the extension relay.
4. The AI can see the todo list and invoke actions (create, toggle, delete)

The AI sees:
```
[root] My App
  [collection] todos (count=2)
    [item] Read the SLOP spec (done=true)  {toggle, delete}
    [item] Build the MVP (done=false)  {toggle, delete}
```

## Server-backed apps

For fullstack frameworks (TanStack Start, Next.js, Nuxt, SvelteKit), use `@slop-ai/server` on the server side. The server owns the public SLOP tree and exposes it via WebSocket. Meta-framework adapters like `@slop-ai/tanstack-start` can also connect the browser UI back to that server and mount it under the conventional `ui` subtree, so AI consumers still subscribe to one provider.

```ts
import { createSlopServer } from "@slop-ai/server";

const slop = createSlopServer({ id: "my-app", name: "My App" });

slop.register("todos", () => ({
  type: "collection",
  items: getTodos().map(t => ({
    id: t.id,
    props: { title: t.title, done: t.done },
    actions: {
      toggle: () => toggleTodo(t.id),
    },
  })),
}));
```

See the [Server & Native Apps guide](/guides/server-apps) or [TanStack Start guide](/guides/tanstack-start) for full setup.

## Python

SLOP also ships a Python SDK for backend services, CLI tools, and desktop apps:

```python
from slop import SlopServer
from slop.transports.asgi import SlopMiddleware

slop = SlopServer("my-api", "My API")

@slop.node("todos")
def todos_node():
    return {
        "type": "collection",
        "items": [{"id": t.id, "props": {"title": t.title, "done": t.done}} for t in get_todos()],
    }

# FastAPI integration
app.add_middleware(SlopMiddleware, slop=slop)
```

See the [Python guide](/guides/python) for full setup including ASGI, WebSocket, Unix socket, and stdio transports.

## Go

```go
import slop "github.com/slop-ai/slop-go"

server := slop.NewServer("my-api", "My API")

server.Register("todos", slop.Node{
    Type:  "collection",
    Props: slop.Props{"count": len(todos)},
    Items: todosToItems(todos),
})

// Works with any net/http router
server.Mount(mux) // adds /slop (ws) + /.well-known/slop
```

See the [Go guide](/guides/go) for full setup including `net/http`, WebSocket, Unix socket, and stdio transports.

## Rust

```rust
use slop_ai::SlopServer;
use serde_json::json;

let slop = SlopServer::new("my-app", "My App");

slop.register("todos", json!({
    "type": "collection",
    "props": {"count": todos.len()},
}));
```

See the [Rust guide](/guides/rust) for full setup including WebSocket, Unix socket, stdio, and axum transports.

## Next steps

- [Installation guide](/getting-started/installation) — all package options
- [React guide](/guides/react) — full React integration patterns
- [Other frameworks](/guides/vue) — Vue, Solid, Angular, Svelte, vanilla JS
- [Python guide](/guides/python) — FastAPI, CLI tools, desktop apps
- [Go guide](/guides/go) — net/http, CLI tools, infrastructure
- [Rust guide](/guides/rust) — systems, CLI, axum, WASM-ready
- [API Reference](/api/core) — `createSlop`, `register`, `scope`, typed schemas
