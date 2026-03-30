//! # slop-ai
//!
//! Rust SDK for the [SLOP protocol](https://slopai.dev) — let AI observe and
//! interact with your app's state.
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
pub use tools::{affordances_to_tools, decode_tool, encode_tool, format_tree, LlmFunction, LlmTool};
pub use types::{
    Affordance, ContentRef, ContentType, Estimate, NodeMeta, PatchOp, PatchOpKind, SlopNode,
    Urgency,
};

#[cfg(feature = "native")]
pub use consumer::{ClientTransport, SlopConsumer};
