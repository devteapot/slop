//! Axum integration — WebSocket handler + discovery route.
//!
//! ```no_run
//! use axum::Router;
//! use slop_ai::SlopServer;
//! use slop_ai::transport::axum::slop_router;
//!
//! #[tokio::main]
//! async fn main() {
//!     let slop = SlopServer::new("my-app", "My App");
//!     let app = Router::new().merge(slop_router(&slop));
//!     let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
//!     axum::serve(listener, app).await.unwrap();
//! }
//! ```

use std::sync::{Arc, Mutex};

use ::axum::extract::ws::{Message, WebSocket};
use ::axum::extract::WebSocketUpgrade;
use ::axum::response::{IntoResponse, Json};
use ::axum::routing::get;
use ::axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

struct AxumWsConnection {
    sender: Mutex<futures_util::stream::SplitSink<WebSocket, Message>>,
}

impl Connection for AxumWsConnection {
    fn send(&self, message: &Value) -> Result<()> {
        let json = serde_json::to_string(message)?;
        let mut sender = self.sender.lock().map_err(|e| SlopError::Transport(e.to_string()))?;
        let rt = tokio::runtime::Handle::try_current()
            .map_err(|e| SlopError::Transport(e.to_string()))?;
        rt.block_on(async {
            sender
                .send(Message::Text(json))
                .await
                .map_err(|e| SlopError::Transport(e.to_string()))
        })
    }

    fn close(&self) -> Result<()> {
        let mut sender = self.sender.lock().map_err(|e| SlopError::Transport(e.to_string()))?;
        let rt = tokio::runtime::Handle::try_current()
            .map_err(|e| SlopError::Transport(e.to_string()))?;
        rt.block_on(async {
            let _ = sender.send(Message::Close(None)).await;
            Ok(())
        })
    }
}

/// Create an axum `Router` with SLOP endpoints:
/// - `GET /slop` — WebSocket upgrade
/// - `GET /.well-known/slop` — discovery endpoint
pub fn slop_router(slop: &SlopServer) -> Router {
    let slop_ws = slop.clone();
    let slop_discovery = slop.clone();

    Router::new()
        .route(
            "/slop",
            get(move |ws: WebSocketUpgrade| {
                let slop = slop_ws.clone();
                async move { ws.on_upgrade(move |socket| handle_ws(slop, socket)) }
            }),
        )
        .route(
            "/.well-known/slop",
            get(move || {
                let slop = slop_discovery.clone();
                async move {
                    let tree = slop.tree();
                    Json(json!({
                        "id": tree.id,
                        "name": tree.properties.as_ref()
                            .and_then(|p| p.get("label"))
                            .and_then(|v| v.as_str())
                            .unwrap_or(""),
                        "slop_version": "0.1",
                        "transport": {"type": "ws", "url": "ws://localhost/slop"},
                        "capabilities": ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
                    }))
                }
            }),
        )
}

async fn handle_ws(slop: SlopServer, socket: WebSocket) {
    let (sender, mut receiver) = socket.split();
    let conn: Arc<dyn Connection> = Arc::new(AxumWsConnection {
        sender: Mutex::new(sender),
    });

    slop.handle_connection(conn.clone());

    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                slop.handle_message(&conn, &parsed);
            }
        }
    }

    slop.handle_disconnect(&conn);
}
