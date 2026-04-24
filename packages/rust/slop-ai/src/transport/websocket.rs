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

use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

/// Decision returned by an [`Authenticator`].
///
/// Authentication happens during the HTTP upgrade, before any SLOP message
/// is delivered. Per spec/core/transport.md §Security, tokens MUST be
/// compared in constant time (see [`constant_time_eq`]) and MUST NOT be
/// logged.
pub type Authenticator =
    Arc<dyn Fn(&Request) -> std::result::Result<(), ErrorResponse> + Send + Sync>;

/// Options for [`serve_with_options`].
#[derive(Clone, Default)]
pub struct ServeOptions {
    /// Called for every upgrade request. Return `Ok(())` to accept, or an
    /// `ErrorResponse` (typically 401) to reject. If `None`, non-loopback
    /// upgrades are rejected by default.
    pub authenticate: Option<Authenticator>,
    /// Acceptable `Origin` values for browser clients. If empty, browser
    /// upgrades without a matching origin are rejected.
    pub allowed_origins: Vec<String>,
    /// Disable origin checking. Opt-in only, intended for local development.
    pub insecure_allow_all_origins: bool,
}

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

fn error_response(status: StatusCode, body: &str) -> ErrorResponse {
    let mut resp = tokio_tungstenite::tungstenite::http::Response::new(Some(body.to_string()));
    *resp.status_mut() = status;
    resp
}

fn unauthorized() -> ErrorResponse {
    error_response(StatusCode::UNAUTHORIZED, "Unauthorized")
}

fn forbidden() -> ErrorResponse {
    error_response(StatusCode::FORBIDDEN, "Forbidden")
}

fn is_loopback(addr: &SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(ip) => ip.is_loopback(),
        IpAddr::V6(ip) => ip.is_loopback(),
    }
}

/// Start a SLOP WebSocket server with default secure settings.
///
/// Only loopback clients are accepted; use [`serve_with_options`] to
/// supply an authenticator for remote clients.
pub async fn serve(slop: &SlopServer, addr: &str) -> Result<JoinHandle<()>> {
    serve_with_options(slop, addr, ServeOptions::default()).await
}

/// Start a SLOP WebSocket server with the supplied authentication and
/// origin-check configuration.
pub async fn serve_with_options(
    slop: &SlopServer,
    addr: &str,
    opts: ServeOptions,
) -> Result<JoinHandle<()>> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| SlopError::Transport(e.to_string()))?;

    let slop = slop.clone();
    let opts = Arc::new(opts);

    let handle = tokio::spawn(async move {
        while let Ok((stream, peer)) = listener.accept().await {
            let slop = slop.clone();
            let opts = opts.clone();
            tokio::spawn(async move {
                let allowed: HashSet<String> = opts.allowed_origins.iter().cloned().collect();
                let insecure = opts.insecure_allow_all_origins;
                let authenticate = opts.authenticate.clone();
                let peer_loopback = is_loopback(&peer);

                let callback = |req: &Request, response: Response| -> std::result::Result<Response, ErrorResponse> {
                    // Origin allowlist (only applies when client sent Origin).
                    if !insecure {
                        if let Some(origin) = req.headers().get("origin") {
                            let ok = origin
                                .to_str()
                                .ok()
                                .map(|s| allowed.contains(s))
                                .unwrap_or(false);
                            if !ok {
                                return Err(forbidden());
                            }
                        }
                    }

                    if let Some(ref auth) = authenticate {
                        auth(req)?;
                    } else if !peer_loopback {
                        eprintln!(
                            "[slop] refusing non-loopback WebSocket upgrade: no authenticate hook configured. \
                             See spec/core/transport.md §Security considerations."
                        );
                        return Err(unauthorized());
                    }

                    Ok(response)
                };

                let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
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

/// Constant-time comparison helper for bearer-token equality checks.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
