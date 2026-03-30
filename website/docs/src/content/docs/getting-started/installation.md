---
title: Installation
description: Install SLOP packages for your framework
---

## Core + Client packages

Every SLOP integration starts with `@slop-ai/client` (which depends on `@slop-ai/core`):

```bash
bun add @slop-ai/client
# or: npm install @slop-ai/client
```

`@slop-ai/client` gives you `createSlop`, `register`, `unregister`, `scope`, and typed schemas. `@slop-ai/core` is the shared engine — it exports types and helpers (`action`, `pick`, `omit`, `NodeDescriptor`) but `createSlop` lives in `@slop-ai/client`. Both work in any JavaScript environment (browser, Node, Bun, Deno).

## Framework adapters

Add the adapter for your framework:

| Framework | Package | Install |
|---|---|---|
| React | `@slop-ai/react` | `bun add @slop-ai/react` |
| Vue 3 | `@slop-ai/vue` | `bun add @slop-ai/vue` |
| SolidJS | `@slop-ai/solid` | `bun add @slop-ai/solid` |
| Angular 16+ | `@slop-ai/angular` | `bun add @slop-ai/angular` |
| Svelte 5 | — | Use `@slop-ai/client` directly |
| Vanilla JS | — | Use `@slop-ai/client` directly |

Svelte and vanilla JS don't need an adapter — `$effect` + `onDestroy` (Svelte) or `store.subscribe` (vanilla) map directly to `register`/`unregister`. Use `@slop-ai/client` directly.

## Server packages

For server-backed and native apps:

| Package | Use case |
|---|---|
| `@slop-ai/server` | Server provider — WebSocket, Unix socket, stdio |
| `@slop-ai/tanstack-start` | TanStack Start adapter — full integration |

```bash
bun add @slop-ai/server
# or for TanStack Start:
bun add @slop-ai/server @slop-ai/tanstack-start
```

## Consumer package

For building AI agents or tools that connect to SLOP providers:

```bash
bun add @slop-ai/consumer
```

This includes `SlopConsumer`, `StateMirror`, transport implementations (WebSocket, postMessage), and LLM tool utilities.

## Python

One package for everything:

```bash
pip install slop-ai[websocket]
```

Zero required dependencies. The `[websocket]` extra installs `websockets` for the WebSocket transport.

### Quick example (FastAPI)

```python
from fastapi import FastAPI
from slop import SlopServer
from slop.transports.asgi import SlopMiddleware

app = FastAPI()
slop = SlopServer("my-api", "My API")

@slop.node("todos")
def todos_node():
    return {
        "type": "collection",
        "items": [{"id": t.id, "props": {"title": t.title}} for t in get_todos()],
    }

@slop.action("todos", "create", params={"title": "string"})
def create_todo(title: str):
    db.create_todo(title)
    slop.refresh()

app.add_middleware(SlopMiddleware, slop=slop)
```

See the [Python guide](/guides/python) for full setup with all transports.

## Go

```bash
go get github.com/slop-ai/slop-go
```

Single external dependency (`nhooyr.io/websocket`). Works with any `net/http` compatible router.

### Quick example

```go
package main

import (
    "net/http"
    slop "github.com/slop-ai/slop-go"
)

func main() {
    server := slop.NewServer("my-app", "My App")

    server.Register("status", slop.Node{
        Type:  "status",
        Props: slop.Props{"healthy": true},
    })

    server.Mount(http.DefaultServeMux) // adds /slop (ws) + /.well-known/slop
    http.ListenAndServe(":8080", nil)
}
```

See the [Go guide](/guides/go) for full setup with all transports.

## Rust

```bash
cargo add slop-ai
```

Zero required dependencies for the core engine. Feature flags control transports.

### Quick example

```rust
use slop_ai::SlopServer;
use serde_json::json;

let slop = SlopServer::new("my-app", "My App");
slop.register("status", json!({"type": "status", "props": {"healthy": true}}));
```

See the [Rust guide](/guides/rust) for full setup with all transports.

## Browser extension

The SLOP Chrome extension discovers providers on any web page and provides an AI chat overlay.

1. Download from the [Chrome Web Store](#) (coming soon)
2. Or sideload: clone the repo, `cd extension && bun run build.ts`, load `extension/` as unpacked in `chrome://extensions`

## Desktop app

The SLOP desktop app connects to all your providers — local apps, web apps, and SPAs through the extension bridge.

1. Download from [Releases](#) (coming soon)
2. Or build from source: `cd desktop && bunx tauri dev`
