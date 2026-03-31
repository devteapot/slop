//! Transport implementations for connecting consumers to the SLOP server.
//!
//! Each transport is behind a feature flag:
//! - `websocket` — WebSocket via tokio-tungstenite
//! - `unix` — Unix domain socket with NDJSON
//! - `stdio` — stdin/stdout with NDJSON
//! - `axum` — axum WebSocket handler + discovery route

#[cfg(feature = "websocket")]
pub mod websocket;

#[cfg(feature = "websocket")]
pub mod ws_client;

#[cfg(feature = "websocket")]
pub mod ws_accepted;

#[cfg(feature = "unix")]
pub mod unix;

#[cfg(feature = "unix")]
pub mod unix_client;

#[cfg(feature = "stdio")]
pub mod stdio;

#[cfg(feature = "axum")]
pub mod axum;
