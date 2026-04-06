//! # slop-ai
//!
//! Rust SDK for the [SLOP protocol](https://slopai.dev) — let AI observe and
//! interact with your app's state.
//!
//! ## Core types
//!
//! - [`SlopServer`] — publish state and register affordances (actions an AI can invoke)
//! - [`SlopConsumer`] — subscribe to a provider and invoke affordances *(requires `native` feature)*
//! - [`StateMirror`] — apply JSON patches and maintain a local replica of remote state
//! - [`SlopNode`], [`Affordance`], [`PatchOp`] — protocol data types
//!
//! ## Transports
//!
//! Each transport is behind a feature flag:
//!
//! | Feature | Transport | Use case |
//! |---------|-----------|----------|
//! | `websocket` | [`transport::websocket`], [`WsClientTransport`] | Browser-compatible, cross-network |
//! | `unix` | [`transport::unix`], [`UnixClientTransport`] | Fast local IPC |
//! | `stdio` | [`transport::stdio`] | CLI tools, child processes |
//! | `axum` | [`transport::axum`] | Embed in an Axum HTTP server |
//!
//! The `native` feature (on by default) enables `websocket` + `unix` + `stdio`.
//!
//! ## LLM integration
//!
//! - [`affordances_to_tools`] — convert affordances into OpenAI-compatible tool definitions
//! - [`format_tree`] — render state as Markdown for LLM context injection
//! - [`prepare_tree`] / [`auto_compact`] — scale trees to fit token budgets
//!
//! ## Quick start
//!
//! ```
//! use slop_ai::{SlopServer, ActionOptions};
//! use serde_json::json;
//!
//! let slop = SlopServer::new("my-app", "My App");
//!
//! slop.register("todos", json!({
//!     "type": "collection",
//!     "props": {"count": 0},
//! }));
//!
//! slop.action_with("todos", "add", |params| {
//!     let text = params["text"].as_str().unwrap_or("untitled");
//!     Ok(Some(json!({ "added": text })))
//! }, ActionOptions::new().label("Add todo"));
//!
//! assert_eq!(slop.version(), 2);
//! ```
//!
//! ## Documentation
//!
//! - Project docs: <https://docs.slopai.dev/api/rust>
//! - Integration guide: <https://docs.slopai.dev/guides/rust>
//! - crates.io docs: <https://docs.rs/slop-ai>

#![cfg_attr(docsrs, feature(doc_auto_cfg))]

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

#[cfg(feature = "native")]
pub mod discovery;

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
