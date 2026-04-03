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

use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

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

                let (mut sender, mut receiver) = ws_stream.split();
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
            });
        }
    });

    Ok(handle)
}
