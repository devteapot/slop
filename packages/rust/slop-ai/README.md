# `slop-ai`

Rust SDK for SLOP (State Layer for Observable Programs).

Expose application state as a structured tree that AI agents can subscribe to, inspect, and act on over WebSocket, Unix socket, stdio, or Axum-backed endpoints.

[![Crates.io](https://img.shields.io/crates/v/slop-ai.svg)](https://crates.io/crates/slop-ai)
[![Documentation](https://img.shields.io/docsrs/slop-ai)](https://docs.rs/slop-ai)

## Installation

```sh
cargo add slop-ai
```

For Axum integration:

```sh
cargo add slop-ai --features axum
```

## Quick start

```rust
use serde_json::json;
use slop_ai::SlopServer;

let slop = SlopServer::new("my-app", "My App");

slop.register("todos", json!({
    "type": "collection",
    "props": { "count": 1 },
    "items": [
        { "id": "1", "props": { "title": "Ship docs", "done": false } }
    ]
}));
```

## Feature flags

| Feature | Default | Description |
| --- | --- | --- |
| `native` | Yes | Enables the native transport set |
| `websocket` | No | WebSocket provider and client support |
| `unix` | No | Unix socket provider and client support |
| `stdio` | No | Stdio transport for CLI and subprocess workflows |
| `axum` | No | Axum WebSocket integration |

## Documentation

- Project API page: https://docs.slopai.dev/api/rust
- Rust guide: https://docs.slopai.dev/guides/rust
- docs.rs: https://docs.rs/slop-ai
