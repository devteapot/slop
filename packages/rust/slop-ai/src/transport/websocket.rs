//! WebSocket transport using tokio-tungstenite.
//!
//! ```no_run
//! use slop_ai::SlopServer;
//! use slop_ai::transport::websocket;
//!
//! #[tokio::main]
//! async fn main() {
//!     let slop = SlopServer::new("my-app", "My App");
//!     let handle = websocket::serve(&slop, "0.0.0.0:8765").await.unwrap();
//!     handle.await.unwrap();
//! }
//! ```

use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

struct WsConnection {
    sender: Mutex<futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
        Message,
    >>,
}

impl Connection for WsConnection {
    fn send(&self, message: &Value) -> Result<()> {
        let json = serde_json::to_string(message)?;
        let mut sender = self.sender.lock().map_err(|e| SlopError::Transport(e.to_string()))?;
        // Use try_send pattern — we're in a sync context
        // For proper async, we'd need a channel. This is a pragmatic approach.
        let rt = tokio::runtime::Handle::try_current()
            .map_err(|e| SlopError::Transport(e.to_string()))?;
        rt.block_on(async {
            sender
                .send(Message::Text(json.into()))
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

/// Start a SLOP WebSocket server at the given address.
///
/// Returns a `JoinHandle` that resolves when the server shuts down.
pub async fn serve(slop: &SlopServer, addr: &str) -> Result<JoinHandle<()>> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| SlopError::Transport(e.to_string()))?;

    let slop = slop.clone();

    let handle = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let slop = slop.clone();
            tokio::spawn(async move {
                let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                    Ok(ws) => ws,
                    Err(_) => return,
                };

                let (sender, mut receiver) = ws_stream.split();
                let conn: Arc<dyn Connection> = Arc::new(WsConnection {
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
            });
        }
    });

    Ok(handle)
}
