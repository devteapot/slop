---
title: "Rust"
description: "Add SLOP to Rust apps — axum, CLI tools, daemons, WASM-ready"
---
## Install

```bash
cargo add slop-ai
```

The core engine (types, tree assembly, diffing) has **zero async runtime dependency** — it compiles to WASM. Transports are behind feature flags:

| Feature | What it adds | Dependencies |
|---|---|---|
| `native` (default) | All native transports | tokio, tokio-tungstenite, futures-util |
| `websocket` | WebSocket transport | tokio, tokio-tungstenite, futures-util |
| `unix` | Unix socket transport | tokio |
| `stdio` | Stdin/stdout transport | tokio |
| `axum` | axum WebSocket + discovery handler | axum, tokio |

```bash
# Default — all native transports
cargo add slop-ai

# Just axum integration
cargo add slop-ai --no-default-features --features axum

# Core only (no transports, WASM-compatible)
cargo add slop-ai --no-default-features
```

## axum web service

```rust
use slop_ai::{SlopServer, ActionOptions};
use slop_ai::transport::axum::slop_router;
use axum::Router;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() {
    let slop = SlopServer::new("my-api", "My API");

    // Static registration — json! macro
    slop.register("status", json!({"type": "status", "props": {"healthy": true}}));

    // Dynamic registration — closure re-evaluated on refresh()
    let todos: Arc<Mutex<Vec<Todo>>> = Arc::new(Mutex::new(vec![]));
    let todos_ref = todos.clone();
    slop.register_fn("todos", move || {
        let todos = todos_ref.lock().unwrap();
        json!({
            "type": "collection",
            "props": {"count": todos.len()},
            "items": todos.iter().map(|t| json!({
                "id": t.id,
                "props": {"title": t.title, "done": t.done}
            })).collect::<Vec<_>>()
        })
    });

    // Action handler
    let todos_ref = todos.clone();
    slop.action("todos", "create", move |params: &serde_json::Value| {
        let title = params["title"].as_str().unwrap();
        todos_ref.lock().unwrap().push(Todo::new(title));
        Ok(None)
    });

    // Action with metadata
    let todos_ref = todos.clone();
    slop.action_with("todos", "clear", move |_| {
        todos_ref.lock().unwrap().clear();
        Ok(None)
    }, ActionOptions::new().dangerous(true).label("Clear all"));

    // axum router with SLOP endpoints
    let app = Router::new()
        .merge(slop_router(&slop));  // /slop (ws) + /.well-known/slop (get)

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

After mutations outside SLOP:

```rust
slop.refresh(); // re-evaluate all register_fn closures, diff, broadcast
```

## WebSocket (standalone)

```rust
use slop_ai::SlopServer;
use slop_ai::transport::websocket;

#[tokio::main]
async fn main() {
    let slop = SlopServer::new("my-app", "My App");
    // ... register nodes ...

    let handle = websocket::serve(&slop, "0.0.0.0:8765").await.unwrap();
    handle.await.unwrap();
}
```

## Unix socket (daemons, CLI)

```rust
use slop_ai::SlopServer;
use slop_ai::transport::unix;

#[tokio::main]
async fn main() {
    let slop = SlopServer::new("my-daemon", "My Daemon");
    // ... register nodes ...

    let handle = unix::listen(&slop, "/tmp/slop/my-daemon.sock").await.unwrap();

    // Optional: register for discovery
    unix::register_provider("my-daemon", "My Daemon", "/tmp/slop/my-daemon.sock").unwrap();

    handle.await.unwrap();
}
```

## Unix socket (CLI tools)

```rust
use slop_ai::SlopServer;
use slop_ai::transport::unix;

#[tokio::main]
async fn main() {
    let slop = SlopServer::new("my-cli", "My CLI Tool");
    slop.register("status", serde_json::json!({"type": "status", "props": {"running": true}}));

    println!("Listening on /tmp/slop/my-cli.sock");
    // stdout is free for human-readable output
    let handle = unix::listen(&slop, "/tmp/slop/my-cli.sock").await.unwrap();
    handle.await.unwrap();
}
```

## Descriptors

Descriptors are `serde_json::Value` — use the `json!` macro:

```rust
slop.register("inbox", json!({
    "type": "collection",
    "summary": "42 messages, 5 unread",
    "props": {"count": 42, "unread": 5},
    "items": [
        {"id": "msg-1", "props": {"from": "alice", "subject": "Hello"}},
        {"id": "msg-2", "props": {"from": "bob", "subject": "Meeting"}},
    ],
    "meta": {"salience": 0.8, "urgency": "medium"}
}));
```

### Content references

```rust
slop.register("editor/main-rs", json!({
    "type": "document",
    "props": {"title": "main.rs", "language": "rust"},
    "content_ref": {
        "type": "text",
        "mime": "text/rust",
        "summary": "Rust axum server, 200 lines",
        "preview": "use axum::Router;\n..."
    }
}));
```

## Scoped registration

```rust
let settings = slop.scope("settings");
settings.register("account", json!({"type": "group", "props": {"email": "a@b.com"}}));
settings.register("theme", json!({"type": "group", "props": {"dark": true}}));
// registers at "settings/account" and "settings/theme"
```

## Thread safety

`SlopServer` is `Clone` (wraps `Arc<RwLock<...>>`). Share it across threads freely:

```rust
let slop = SlopServer::new("app", "App");

// Pass to axum handler
let slop_clone = slop.clone();
let app = Router::new().route("/api/todos", post(move || async move {
    // ... create todo ...
    slop_clone.refresh();
    StatusCode::CREATED
}));
```

## WASM

The core engine compiles to `wasm32-unknown-unknown` with `--no-default-features`. WASM-specific transports (WebSocket via `web-sys`, postMessage) are planned for a future release.

```bash
cargo build --target wasm32-unknown-unknown --no-default-features
```

## Multiple transports

```rust
let slop = SlopServer::new("app", "App");

// WebSocket for remote consumers
let ws_handle = websocket::serve(&slop, "0.0.0.0:8765").await?;

// Unix socket for local agents
let unix_handle = unix::listen(&slop, "/tmp/slop/app.sock").await?;

tokio::select! {
    _ = ws_handle => {},
    _ = unix_handle => {},
}
```

## Consumer

Connect to a SLOP provider, subscribe to state, and invoke actions (requires `native` feature):

```rust
use slop_ai::{SlopConsumer, ClientTransport};
use serde_json::json;

// Implement ClientTransport or use a built-in one
let consumer = SlopConsumer::new();
let hello = consumer.connect(&transport).await?;
println!("Connected to {:?}", hello);

let (sub_id, snapshot) = consumer.subscribe("/", -1).await?;
println!("Got tree: {}", snapshot.id);

// Invoke an action
let result = consumer.invoke("/todos", "create", Some(json!({"title": "New task"}))).await?;

// Listen for patches
consumer.on_patch(|sub_id, ops, version| {
    println!("Patch v{}: {} ops", version, ops.len());
});

// Query a subtree
let node = consumer.query("/todos", 1).await?;

consumer.disconnect();
```

## Discovery layer

The Rust SDK also includes the core discovery layer in `slop_ai::discovery` under the default `native` feature set:

```rust
use slop_ai::discovery::{DiscoveryService, DiscoveryServiceOptions};

#[tokio::main]
async fn main() {
    let service = DiscoveryService::new(DiscoveryServiceOptions::default());
    service.start().await;

    if let Ok(Some(provider)) = service.ensure_connected("my-app").await {
        println!("{}", provider.name);
    }

    service.stop().await;
}
```

## Scaling

Prepare trees for output with depth truncation, salience filtering, and node-budget compaction:

```rust
use slop_ai::{prepare_tree, truncate_tree, filter_tree, auto_compact, OutputTreeOptions};

// Apply all scaling in one call
let opts = OutputTreeOptions {
    max_depth: Some(2),
    min_salience: Some(0.3),
    max_nodes: Some(50),
    ..Default::default()
};
let prepared = prepare_tree(&tree, &opts);

// Or apply individually
let shallow = truncate_tree(&tree, 2);
let relevant = filter_tree(&tree, Some(0.5), None);
let compact = auto_compact(&tree, 50);

// Extract a subtree
if let Some(sub) = get_subtree(&tree, "/inbox/msg-42") {
    println!("Found: {}", sub.id);
}
```

## LLM tools

Convert a SLOP tree into LLM-compatible tool definitions:

```rust
use slop_ai::{affordances_to_tools, format_tree, encode_tool, decode_tool};

// Convert tree affordances to OpenAI-style tool list
let tools = affordances_to_tools(&tree, "");

// Format tree as readable text for LLM context
let context = format_tree(&tree, 0);

// Encode/decode tool names
let name = encode_tool("/todos", "create");  // "invoke__todos__create"
let (path, action) = decode_tool(&name);     // ("/todos", "create")
```
