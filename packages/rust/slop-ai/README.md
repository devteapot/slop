# slop-ai

Rust SDK for SLOP (State Layer for Observable Programs).

Expose your application's state as a structured tree that AI agents can observe,
subscribe to, and act on -- over WebSocket, Unix socket, or stdio.

[![Crates.io](https://img.shields.io/crates/v/slop-ai.svg)](https://crates.io/crates/slop-ai)
[![Documentation](https://img.shields.io/docsrs/slop-ai)](https://docs.rs/slop-ai)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Installation

```sh
cargo add slop-ai
```

To use the Axum integration:

```sh
cargo add slop-ai --features axum
```

## Quick start

```rust
use slop_ai::{SlopServer, ActionOptions};
use serde_json::json;

let slop = SlopServer::new("my-app", "My App");

// Register a node in the state tree
slop.register("todos", json!({
    "type": "collection",
    "props": { "count": 0 },
}));

// Register an action handler
slop.action("todos", "add", |params| {
    let title = params["title"].as_str().unwrap_or("untitled");
    println!("Adding todo: {title}");
    Ok(Some(json!({ "ok": true })))
});

// Update state — connected consumers receive diffs automatically
slop.register("todos", json!({
    "type": "collection",
    "props": { "count": 1 },
}));
```

## Feature flags

| Feature     | Default | Description                                    |
|-------------|---------|------------------------------------------------|
| `native`    | Yes     | Enables `websocket` + `unix` + `stdio`         |
| `websocket` | --      | WebSocket transport via `tokio-tungstenite`     |
| `unix`      | --      | Unix domain socket transport                    |
| `stdio`     | --      | Stdin/stdout transport                          |
| `axum`      | --      | `axum` WebSocket handler integration            |

Disable defaults to pick only the transports you need:

```toml
[dependencies]
slop-ai = { version = "0.1", default-features = false, features = ["axum"] }
```

## Key types

- **`SlopServer`** -- core server; manages registrations, subscriptions, and action dispatch.
- **`SlopConsumer`** -- client that connects to a SLOP server and observes state (requires `native`).
- **`SlopNode`** -- a single node in the state tree (wire format).
- **`ActionOptions`** -- builder for action metadata (label, params schema, dangerous flag, etc.).

## Documentation

- [Rust guide](https://docs.slopai.dev/guides/rust)
- [API reference (docs.rs)](https://docs.rs/slop-ai)
- [SLOP specification](https://github.com/devteapot/slop/tree/main/spec)

## License

MIT
