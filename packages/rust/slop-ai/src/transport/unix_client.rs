//! Unix domain socket client transport — connects to an existing SLOP
//! provider's Unix socket and implements [`ClientTransport`] using NDJSON.
//!
//! ```no_run
//! use slop_ai::SlopConsumer;
//! use slop_ai::transport::unix_client::UnixClientTransport;
//!
//! #[tokio::main]
//! async fn main() {
//!     let transport = UnixClientTransport::new("/tmp/slop/my-app.sock");
//!     let consumer = SlopConsumer::new();
//!     let hello = consumer.connect(&transport).await.unwrap();
//!     println!("Connected: {:?}", hello);
//! }
//! ```

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

use crate::consumer::ClientTransport;
use crate::error::{Result, SlopError};

/// A [`ClientTransport`] that connects to a SLOP provider via Unix domain socket (NDJSON).
pub struct UnixClientTransport {
    path: String,
}

impl UnixClientTransport {
    pub fn new(path: &str) -> Self {
        Self {
            path: path.to_string(),
        }
    }
}

impl ClientTransport for UnixClientTransport {
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
        let path = self.path.clone();
        Box::pin(async move {
            let stream = UnixStream::connect(&path)
                .await
                .map_err(|e| SlopError::Transport(format!("Unix connect to {path}: {e}")))?;

            let (reader, mut writer) = tokio::io::split(stream);

            // consumer → provider: serialise Value to NDJSON line
            let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<Value>();
            tokio::spawn(async move {
                while let Some(msg) = outgoing_rx.recv().await {
                    let mut line = match serde_json::to_string(&msg) {
                        Ok(j) => j,
                        Err(_) => continue,
                    };
                    line.push('\n');
                    if writer.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                }
                let _ = writer.shutdown().await;
            });

            // provider → consumer: read NDJSON lines
            let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<Value>();
            tokio::spawn(async move {
                let mut lines = BufReader::new(reader).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        if incoming_tx.send(value).is_err() {
                            break;
                        }
                    }
                }
            });

            Ok((outgoing_tx, incoming_rx))
        })
    }
}
