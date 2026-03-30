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
pub mod server;
pub mod transport;
pub mod tree;
pub mod types;

// Re-export main types at crate root
pub use error::{Result, SlopError};
pub use server::{ActionOptions, Connection, ScopedServer, SlopServer};
pub use types::{
    Affordance, ContentRef, ContentType, Estimate, NodeMeta, PatchOp, PatchOpKind, SlopNode,
    Urgency,
};
