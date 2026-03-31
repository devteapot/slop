//! WebSocket client transport — connects to an existing SLOP provider's
//! WebSocket endpoint and implements [`ClientTransport`].
//!
//! ```no_run
//! use slop_ai::SlopConsumer;
//! use slop_ai::transport::ws_client::WsClientTransport;
//!
//! #[tokio::main]
//! async fn main() {
//!     let transport = WsClientTransport::new("ws://localhost:8765/slop");
//!     let consumer = SlopConsumer::new();
//!     let hello = consumer.connect(&transport).await.unwrap();
//!     println!("Connected: {:?}", hello);
//! }
//! ```

use std::future::Future;
use std::pin::Pin;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::consumer::ClientTransport;
use crate::error::{Result, SlopError};

/// A [`ClientTransport`] that connects to a SLOP provider via WebSocket.
pub struct WsClientTransport {
    url: String,
}

impl WsClientTransport {
    pub fn new(url: &str) -> Self {
        Self {
            url: url.to_string(),
        }
    }
}

impl ClientTransport for WsClientTransport {
    fn connect(
        &self,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<(
                        mpsc::UnboundedSender<Value>,
                        mpsc::UnboundedReceiver<Value>,
                    )>,
                > + Send,
        >,
    > {
        let url = self.url.clone();
        Box::pin(async move {
            let (ws_stream, _) = tokio_tungstenite::connect_async(&url)
                .await
                .map_err(|e| SlopError::Transport(format!("WebSocket connect to {url}: {e}")))?;

            let (mut ws_write, mut ws_read) = ws_stream.split();

            // consumer → provider: serialise Value to WS text frame
            let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<Value>();
            tokio::spawn(async move {
                while let Some(msg) = outgoing_rx.recv().await {
                    let json = match serde_json::to_string(&msg) {
                        Ok(j) => j,
                        Err(_) => continue,
                    };
                    if ws_write.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                let _ = ws_write.close().await;
            });

            // provider → consumer: deserialise WS text frame to Value
            let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<Value>();
            tokio::spawn(async move {
                while let Some(Ok(msg)) = ws_read.next().await {
                    if let Message::Text(text) = msg {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            if incoming_tx.send(value).is_err() {
                                break;
                            }
                        }
                    }
                }
            });

            Ok((outgoing_tx, incoming_rx))
        })
    }
}
