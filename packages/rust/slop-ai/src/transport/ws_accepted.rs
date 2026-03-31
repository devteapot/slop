//! Accepted WebSocket transport — wraps an already-established WebSocket stream
//! into a [`ClientTransport`].
//!
//! Used when a provider *connects to us* (e.g. a browser SPA connecting to the
//! desktop app's WebSocket server). The desktop then consumes the provider over
//! the same connection.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use crate::consumer::ClientTransport;
use crate::error::Result;

/// A [`ClientTransport`] that wraps an already-connected WebSocket stream.
///
/// Unlike [`WsClientTransport`](super::ws_client::WsClientTransport) which
/// opens a new connection, this takes ownership of an existing
/// `WebSocketStream` — typically one accepted by a server.
///
/// `connect()` may only be called once; subsequent calls return an error.
pub struct AcceptedWsTransport<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static> {
    stream: Arc<Mutex<Option<WebSocketStream<S>>>>,
}

impl<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static> AcceptedWsTransport<S> {
    pub fn new(stream: WebSocketStream<S>) -> Self {
        Self {
            stream: Arc::new(Mutex::new(Some(stream))),
        }
    }
}

impl<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static> ClientTransport
    for AcceptedWsTransport<S>
{
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
        let stream = Arc::clone(&self.stream);

        Box::pin(async move {
            let ws_stream = stream
                .lock()
                .await
                .take()
                .ok_or(crate::error::SlopError::Transport(
                    "AcceptedWsTransport: stream already consumed".into(),
                ))?;

            let (mut ws_write, mut ws_read) = ws_stream.split();

            // outgoing: consumer → provider
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

            // incoming: provider → consumer
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
