---
title: "slop-ai (Rust)"
description: Rust crate reference for SLOP providers, consumers, and transport features
---

```bash
cargo add slop-ai
```

## Main exports

- `SlopServer` and `ScopedServer`
- `SlopConsumer` when the `native` feature is enabled
- transport modules for WebSocket, Unix socket, stdio, and Axum
- scaling helpers such as `prepare_tree()` and `auto_compact()`
- LLM tool helpers such as `affordances_to_tools()` and `format_tree()`

## Feature flags

- `native` for the common native transport set
- `websocket`
- `unix`
- `stdio`
- `axum`

## Related pages

- [Rust guide](/guides/rust)
- [Consumer guide](/guides/consumer)
