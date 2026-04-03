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

use std::sync::Arc;

use ::axum::extract::ws::{Message, WebSocket};
use ::axum::extract::WebSocketUpgrade;
use ::axum::response::{IntoResponse, Json};
use ::axum::routing::get;
use ::axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

enum ConnMessage {
    Send(Value),
    Close,
}

struct ChannelConnection {
    tx: mpsc::UnboundedSender<ConnMessage>,
}

impl Connection for ChannelConnection {
    fn send(&self, message: &Value) -> Result<()> {
        self.tx
            .send(ConnMessage::Send(message.clone()))
            .map_err(|_| SlopError::Transport("connection closed".into()))
    }

    fn close(&self) -> Result<()> {
        let _ = self.tx.send(ConnMessage::Close);
        Ok(())
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
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ConnMessage>();
    let conn: Arc<dyn Connection> = Arc::new(ChannelConnection { tx });

    // Spawn a writer task that drains the channel into the WS sink
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match msg {
                ConnMessage::Send(val) => {
                    let json = serde_json::to_string(&val).unwrap_or_default();
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                ConnMessage::Close => {
                    let _ = sender.send(Message::Close(None)).await;
                    break;
                }
            }
        }
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
