---
title: "Installation"
description: "Install the right SLOP package for your app, agent, or tool"
---
## TypeScript browser packages

Most browser apps start with `@slop-ai/client`, then add the framework adapter that matches the UI layer.

```bash
bun add @slop-ai/client
```

| Framework | Package | Install |
| --- | --- | --- |
| React | `@slop-ai/react` | `bun add @slop-ai/client @slop-ai/react` |
| Vue 3 | `@slop-ai/vue` | `bun add @slop-ai/client @slop-ai/vue` |
| SolidJS | `@slop-ai/solid` | `bun add @slop-ai/client @slop-ai/solid` |
| Angular | `@slop-ai/angular` | `bun add @slop-ai/client @slop-ai/angular` |
| Svelte 5 | `@slop-ai/svelte` | `bun add @slop-ai/client @slop-ai/svelte` |
| Vanilla JS / TS | `@slop-ai/client` | `bun add @slop-ai/client` |

Use `@slop-ai/core` when you need the shared types, helpers, and tree utilities directly:

```bash
bun add @slop-ai/core
```

## TypeScript server and consumer packages

| Package | Use case | Install |
| --- | --- | --- |
| `@slop-ai/server` | Node.js, Bun, desktop helpers, and CLI providers | `bun add @slop-ai/server` |
| `@slop-ai/consumer` | custom agents, inspectors, bridges, and tests | `bun add @slop-ai/consumer` |
| `@slop-ai/tanstack-start` | TanStack Start full-stack integration | `bun add @slop-ai/server @slop-ai/tanstack-start` |
| `@slop-ai/openclaw-plugin` | OpenClaw integration | `bun add @slop-ai/openclaw-plugin` |

## Python

```bash
pip install slop-ai[websocket]
```

```python
from fastapi import FastAPI
from slop_ai import SlopServer
from slop_ai.transports.asgi import SlopMiddleware

app = FastAPI()
slop = SlopServer("my-api", "My API")
app.add_middleware(SlopMiddleware, slop=slop)
```

See the [Python guide](/guides/python) and [Python API page](/api/python) for transport and consumer examples.

## Go

```bash
go get github.com/devteapot/slop/packages/go/slop-ai
```

```go
package main

import (
	"net/http"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

func main() {
	server := slop.NewServer("my-app", "My App")
	server.Mount(http.DefaultServeMux)
	http.ListenAndServe(":8080", nil)
}
```

See the [Go guide](/guides/go) and [Go API page](/api/go) for Unix, stdio, and consumer support.

## Rust

```bash
cargo add slop-ai
```

```rust
use serde_json::json;
use slop_ai::SlopServer;

let slop = SlopServer::new("my-app", "My App");
slop.register("status", json!({"type": "status", "props": {"healthy": true}}));
```

See the [Rust guide](/guides/rust) and [Rust API page](/api/rust) for feature-flag and transport details.

## Apps

### Chrome extension

```bash
cd apps/extension
bun install
bun run build
```

Load the `apps/extension` directory in `chrome://extensions` as an unpacked extension.

### Desktop app

```bash
cd apps/desktop
bun install
bun run dev
```

The Tauri app will build the frontend and launch the native desktop shell.
