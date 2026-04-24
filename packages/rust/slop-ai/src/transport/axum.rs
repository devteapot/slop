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

use std::collections::HashSet;
use std::sync::Arc;

use ::axum::extract::ws::{Message, WebSocket};
use ::axum::extract::WebSocketUpgrade;
use ::axum::http::{HeaderMap, StatusCode};
use ::axum::response::{IntoResponse, Json, Response};
use ::axum::routing::get;
use ::axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

/// Authenticate hook. Receives the incoming request headers and returns
/// `Ok(())` to accept, or a [`StatusCode`] to reject. Per
/// spec/core/transport.md §Security, bearer tokens MUST be compared in
/// constant time.
pub type Authenticator = Arc<dyn Fn(&HeaderMap) -> std::result::Result<(), StatusCode> + Send + Sync>;

/// Options controlling the SLOP axum router.
#[derive(Clone, Default)]
pub struct RouterOptions {
    /// Called for every upgrade request. If `None`, non-loopback upgrades
    /// are rejected with `401`.
    pub authenticate: Option<Authenticator>,
    /// Acceptable `Origin` values for browser clients. If empty, browser
    /// upgrades are rejected.
    pub allowed_origins: Vec<String>,
    /// Disable origin checking. Opt-in only; intended for local development.
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

/// Create an axum `Router` with SLOP endpoints using secure defaults.
///
/// Without [`RouterOptions::authenticate`], all WebSocket upgrades are
/// rejected with `401`. Use [`slop_router_with_options`] to supply an
/// authenticator. For loopback-only development, provide a small
/// authenticator that inspects a trusted header or a custom extractor.
pub fn slop_router(slop: &SlopServer) -> Router {
    slop_router_with_options(slop, RouterOptions::default())
}

/// Create an axum `Router` with SLOP endpoints and the supplied auth
/// configuration.
pub fn slop_router_with_options(slop: &SlopServer, opts: RouterOptions) -> Router {
    let slop_ws = slop.clone();
    let slop_discovery = slop.clone();
    let opts = Arc::new(opts);

    Router::new()
        .route(
            "/slop",
            get({
                let opts = opts.clone();
                move |ws: WebSocketUpgrade, headers: HeaderMap| {
                    let slop = slop_ws.clone();
                    let opts = opts.clone();
                    async move {
                        if let Err(resp) = authorize_upgrade(&headers, &opts) {
                            return resp;
                        }
                        ws.on_upgrade(move |socket| handle_ws(slop, socket))
                            .into_response()
                    }
                }
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

fn authorize_upgrade(
    headers: &HeaderMap,
    opts: &RouterOptions,
) -> std::result::Result<(), Response> {
    // Origin allowlist (only applies when client sent Origin, i.e. browser).
    if !opts.insecure_allow_all_origins {
        if let Some(origin) = headers.get("origin") {
            let allowed: HashSet<&str> = opts.allowed_origins.iter().map(|s| s.as_str()).collect();
            let ok = origin
                .to_str()
                .ok()
                .map(|s| allowed.contains(s))
                .unwrap_or(false);
            if !ok {
                return Err(StatusCode::FORBIDDEN.into_response());
            }
        }
    }

    if let Some(ref auth) = opts.authenticate {
        return auth(headers).map_err(|s| s.into_response());
    }

    eprintln!(
        "[slop] refusing WebSocket upgrade: no authenticate hook configured. \
         See spec/core/transport.md §Security considerations."
    );
    Err(StatusCode::UNAUTHORIZED.into_response())
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
