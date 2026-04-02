//! # slop-ai
//!
//! Rust SDK for the [SLOP protocol](https://slopai.dev) — let AI observe and
//! interact with your app's state.
//!
//! The crate includes:
//!
//! - `SlopServer` for publishing state and affordances
//! - `SlopConsumer` for subscribing to providers when the `native` feature is enabled
//! - transport adapters for WebSocket, Unix socket, stdio, and Axum
//! - tree scaling and LLM tool helpers shared across integrations
//!
//! ## Quick start
//!
//! ```
//! use slop_ai::SlopServer;
//! use serde_json::json;
//!
//! let slop = SlopServer::new("my-app", "My App");
//!
//! slop.register("todos", json!({
//!     "type": "collection",
//!     "props": {"count": 0},
//! }));
//!
//! assert_eq!(slop.version(), 1);
//! ```
//!
//! ## Documentation
//!
//! - Project docs: <https://docs.slopai.dev/api/rust>
//! - Integration guide: <https://docs.slopai.dev/guides/rust>
//! - crates.io docs: <https://docs.rs/slop-ai>

pub mod descriptor;
pub mod diff;
pub mod error;
pub mod scaling;
pub mod server;
pub mod state_mirror;
pub mod tools;
pub mod transport;
pub mod tree;
pub mod types;

#[cfg(feature = "native")]
pub mod consumer;

// Re-export main types at crate root
pub use error::{Result, SlopError};
pub use server::{ActionOptions, Connection, ScopedServer, SlopServer};
pub use scaling::{
    auto_compact, count_nodes, filter_tree, get_subtree, prepare_tree, truncate_tree,
    OutputTreeOptions,
};
pub use state_mirror::StateMirror;
pub use tools::{affordances_to_tools, format_tree, LlmFunction, LlmTool, ToolResolution, ToolSet};
pub use types::{
    Affordance, ContentRef, ContentType, Estimate, NodeMeta, PatchOp, PatchOpKind, SlopNode,
    Urgency,
};

#[cfg(feature = "native")]
pub use consumer::{ClientTransport, SlopConsumer};

#[cfg(feature = "websocket")]
pub use transport::ws_client::WsClientTransport;

#[cfg(feature = "websocket")]
pub use transport::ws_accepted::AcceptedWsTransport;

#[cfg(feature = "unix")]
pub use transport::unix_client::UnixClientTransport;
