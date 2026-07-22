//! Local WebSocket bridge server at ws://localhost:9339/slop-bridge
//!
//! The extension connects here to:
//! 1. Announce discovered browser providers
//! 2. Relay SLOP messages for SPA providers (postMessage-based)
//!
//! Loopback is not a trust boundary: every upgrade is gated by Origin
//! validation and pairing-token authentication (see `security`).

pub mod security;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::Message;

use crate::events;
use crate::provider::{ProviderRegistry, ProviderSource, ProviderSummary, TransportConfig};
use security::{BridgeToken, BEARER_PROTOCOL};

const BRIDGE_PORT: u16 = 9339;

type WsSink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message,
>;

/// Shared state: connected extension WebSocket sinks
pub struct BridgeSinks(pub Arc<Mutex<Vec<Arc<Mutex<WsSink>>>>>);

impl Default for BridgeSinks {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Vec::new())))
    }
}

/// Subscribers for provider-scoped relay messages coming back from the extension.
pub struct RelaySubscribers(pub Arc<Mutex<HashMap<String, Vec<mpsc::UnboundedSender<Value>>>>>);

impl Default for RelaySubscribers {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

/// Start the bridge WebSocket server
pub async fn start_bridge_server(app: AppHandle) {
    let addr = format!("127.0.0.1:{}", BRIDGE_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Bridge: failed to bind to {}: {}", addr, e);
            return;
        }
    };
    println!("Bridge server running at ws://{}/slop-bridge", addr);

    let sinks: Arc<Mutex<Vec<Arc<Mutex<WsSink>>>>> = Arc::new(Mutex::new(Vec::new()));

    let bridge_sinks = BridgeSinks(sinks.clone());
    app.manage(bridge_sinks);
    let relay_subscribers = RelaySubscribers::default();
    app.manage(relay_subscribers);

    loop {
        let (stream, _addr) = match listener.accept().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Bridge: accept error: {}", e);
                continue;
            }
        };

        let app_clone = app.clone();
        let sinks_clone = sinks.clone();

        tokio::spawn(async move {
            // Snapshot the expected token at accept time; connections accepted
            // before a regeneration are explicitly closed by `disconnect_all_clients`.
            let expected_token = app_clone
                .try_state::<Arc<BridgeToken>>()
                .map(|t| t.current())
                .unwrap_or_default();

            let callback = |req: &Request, response: Response| {
                gate_upgrade(req, response, &expected_token)
            };

            let ws_stream = match accept_hdr_async(stream, callback).await {
                Ok(ws) => ws,
                Err(e) => {
                    // Note: rejection errors carry only a status code — never the token.
                    eprintln!("Bridge: WebSocket handshake failed: {}", e);
                    return;
                }
            };

            let (write, mut read) = ws_stream.split();
            let write = Arc::new(Mutex::new(write));

            sinks_clone.lock().await.push(write.clone());
            let _ = app_clone.emit("bridge-status", true);

            // Replay already-known bridge providers to the new client
            if let Some(registry) = app_clone.try_state::<Arc<Mutex<ProviderRegistry>>>() {
                let reg = registry.lock().await;
                for entry in reg.entries.values() {
                    if entry.source != ProviderSource::Bridge {
                        continue;
                    }
                    let (transport_str, url) = match &entry.transport {
                        TransportConfig::Ws { url } => ("ws", Some(url.as_str())),
                        TransportConfig::Relay { .. } => ("postmessage", None),
                        _ => continue,
                    };
                    let mut provider_obj = serde_json::json!({
                        "id": entry.id,
                        "name": entry.name,
                        "transport": transport_str,
                    });
                    if let Some(u) = url {
                        provider_obj["url"] = serde_json::json!(u);
                    }
                    let announce = serde_json::json!({
                        "type": "provider-available",
                        "tabId": entry.bridge_tab_id.unwrap_or(0),
                        "providerKey": entry.id,
                        "provider": provider_obj,
                    });
                    let text = serde_json::to_string(&announce).unwrap_or_default();
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(text.into())).await;
                }
            }

            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            handle_bridge_message(&app_clone, &value).await;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }

            // Remove from sinks
            let mut sinks = sinks_clone.lock().await;
            sinks.retain(|s| !Arc::ptr_eq(s, &write));
            let no_sinks_left = sinks.is_empty();
            drop(sinks);

            if no_sinks_left {
                clear_all_relays(&app_clone).await;
                let _ = app_clone.emit("bridge-status", false);
            }
        });
    }
}

/// Upgrade gate enforcing the bridge security rules from
/// spec/integrations/desktop.md (Bridge security):
///
/// 1. Reject web Origins (`http`/`https` scheme, or literal `null`) with 403.
///    Extension origins and absent Origin pass to the token check.
/// 2. Require a valid pairing token offered via
///    `Sec-WebSocket-Protocol: slop.bearer, <token>`; compare in constant
///    time; reject missing/invalid tokens with 401. On success, echo back
///    only the non-secret `slop.bearer` subprotocol — never the token.
fn gate_upgrade(
    req: &Request,
    mut response: Response,
    expected_token: &str,
) -> Result<Response, ErrorResponse> {
    if let Some(origin) = req.headers().get("Origin").and_then(|v| v.to_str().ok()) {
        if security::origin_is_forbidden(origin) {
            return Err(reject(StatusCode::FORBIDDEN));
        }
    }

    let protocol_values: Vec<&str> = req
        .headers()
        .get_all("Sec-WebSocket-Protocol")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect();

    match security::extract_bearer_token(&protocol_values) {
        Some(offered) if security::token_matches(&offered, expected_token) => {
            response.headers_mut().insert(
                "Sec-WebSocket-Protocol",
                HeaderValue::from_static(BEARER_PROTOCOL),
            );
            Ok(response)
        }
        _ => Err(reject(StatusCode::UNAUTHORIZED)),
    }
}

fn reject(status: StatusCode) -> ErrorResponse {
    let mut response = ErrorResponse::new(None);
    *response.status_mut() = status;
    response
}

/// Close every connected bridge client. Used when the pairing token is
/// regenerated so stale peers must re-pair with the new token.
pub async fn disconnect_all_clients(app: &AppHandle) {
    let Some(sinks_state) = app.try_state::<BridgeSinks>() else {
        return;
    };

    let drained: Vec<_> = {
        let mut sinks = sinks_state.0.lock().await;
        sinks.drain(..).collect()
    };

    for sink in drained {
        let mut s = sink.lock().await;
        let _ = s.send(Message::Close(None)).await;
        let _ = s.close().await;
    }

    clear_all_relays(app).await;
    let _ = app.emit("bridge-status", false);
}

async fn handle_bridge_message(app: &AppHandle, value: &Value) {
    let msg_type = value["type"].as_str().unwrap_or("");

    match msg_type {
        "slop-relay" => {
            if let (Some(provider_key), Some(message)) =
                (value["providerKey"].as_str(), value.get("message"))
            {
                // Dispatch to internal subscribers (Desktop's own relay connections)
                dispatch_relay(app, provider_key, message.clone()).await;
            }
            // Rebroadcast to all sinks so external consumers receive relay
            // responses from the extension, and the extension receives relay
            // messages from external consumers (e.g. CLI, Claude agent)
            let _ = bridge_send_value(app.clone(), value.clone()).await;
        }
        "relay-open" | "relay-close" => {
            // Forward to all sinks so the extension receives relay control
            // messages from external consumers
            let _ = bridge_send_value(app.clone(), value.clone()).await;
        }
        "provider-available" => {
            let tab_id = value["tabId"].as_u64().unwrap_or(0);
            let provider_key = value["providerKey"].as_str().unwrap_or("");
            if !provider_key.is_empty() {
                if let Some(provider) = value.get("provider") {
                    if let Some(registry) = app.try_state::<Arc<Mutex<ProviderRegistry>>>() {
                        let mut reg = registry.lock().await;
                        reg.ingest_bridge_provider(tab_id, provider_key, provider);
                        if let Some(entry) = reg.get_entry(provider_key) {
                            events::emit_provider_discovered(app, ProviderSummary::from(entry));
                        }
                    }
                }
            }
            // Rebroadcast so other bridge consumers (e.g. CLI) receive announcements
            let _ = bridge_send_value(app.clone(), value.clone()).await;
        }
        "provider-unavailable" => {
            if let Some(provider_key) = value["providerKey"].as_str() {
                close_relay(app, provider_key).await;
                events::emit_provider_removed(app, provider_key.to_string());
                if let Some(registry) = app.try_state::<Arc<Mutex<ProviderRegistry>>>() {
                    registry.lock().await.remove_entry(provider_key);
                }
            }
            // Rebroadcast so other bridge consumers receive removal
            let _ = bridge_send_value(app.clone(), value.clone()).await;
        }
        _ => {}
    }

    // Also emit raw bridge message for any frontend listeners
    let _ = app.emit("bridge-message", value.clone());
}

async fn dispatch_relay(app: &AppHandle, provider_key: &str, message: Value) {
    let Some(state) = app.try_state::<RelaySubscribers>() else {
        return;
    };

    let mut subscribers = state.0.lock().await;
    if let Some(listeners) = subscribers.get_mut(provider_key) {
        listeners.retain(|sender| sender.send(message.clone()).is_ok());
        if listeners.is_empty() {
            subscribers.remove(provider_key);
        }
    }
}

async fn close_relay(app: &AppHandle, provider_key: &str) {
    let Some(state) = app.try_state::<RelaySubscribers>() else {
        return;
    };
    state.0.lock().await.remove(provider_key);
}

async fn clear_all_relays(app: &AppHandle) {
    let Some(state) = app.try_state::<RelaySubscribers>() else {
        return;
    };
    state.0.lock().await.clear();
}

pub async fn subscribe_relay(
    app: AppHandle,
    provider_key: &str,
) -> Result<mpsc::UnboundedReceiver<Value>, String> {
    let state = app
        .try_state::<RelaySubscribers>()
        .ok_or_else(|| "Bridge subscribers are not available".to_string())?;

    let (tx, rx) = mpsc::unbounded_channel();
    let mut subscribers = state.0.lock().await;
    subscribers
        .entry(provider_key.to_string())
        .or_default()
        .push(tx);

    Ok(rx)
}

pub async fn bridge_send_value(app: AppHandle, message: Value) -> Result<(), String> {
    let sinks_state = app
        .try_state::<BridgeSinks>()
        .ok_or_else(|| "Bridge not running".to_string())?;

    let text = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    let sinks = sinks_state.0.lock().await;

    if sinks.is_empty() {
        return Err("No extension bridge is connected".into());
    }

    for sink in sinks.iter() {
        let mut s = sink.lock().await;
        s.send(Message::Text(text.clone().into()))
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdefghijklmnopqrstuvwxyzABCDEF_";

    fn upgrade_request(origin: Option<&str>, protocols: Option<&str>) -> Request {
        let mut builder = Request::builder().uri("ws://127.0.0.1:9339/slop-bridge");
        if let Some(origin) = origin {
            builder = builder.header("Origin", origin);
        }
        if let Some(protocols) = protocols {
            builder = builder.header("Sec-WebSocket-Protocol", protocols);
        }
        builder.body(()).unwrap()
    }

    fn gate(origin: Option<&str>, protocols: Option<&str>) -> Result<Response, ErrorResponse> {
        let req = upgrade_request(origin, protocols);
        let response = Response::new(());
        gate_upgrade(&req, response, TOKEN)
    }

    #[test]
    fn rejects_web_origin_with_403_even_with_valid_token() {
        for origin in ["http://localhost:3000", "https://evil.example.com", "null"] {
            let err = gate(Some(origin), Some(&format!("slop.bearer, {}", TOKEN)))
                .expect_err("web origin must be rejected");
            assert_eq!(err.status(), StatusCode::FORBIDDEN);
        }
    }

    #[test]
    fn accepts_extension_origin_with_valid_token_and_echoes_label_only() {
        let response = gate(
            Some("chrome-extension://abcdefghijklmnop"),
            Some(&format!("slop.bearer, {}", TOKEN)),
        )
        .expect("extension origin with valid token must be accepted");

        let echoed = response
            .headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok())
            .expect("subprotocol must be echoed");
        assert_eq!(echoed, BEARER_PROTOCOL);
        assert!(!echoed.contains(TOKEN));
    }

    #[test]
    fn accepts_absent_origin_with_valid_token() {
        let response = gate(None, Some(&format!("slop.bearer, {}", TOKEN)))
            .expect("native client with valid token must be accepted");
        assert_eq!(
            response
                .headers()
                .get("Sec-WebSocket-Protocol")
                .and_then(|v| v.to_str().ok()),
            Some(BEARER_PROTOCOL)
        );
    }

    #[test]
    fn rejects_missing_token_with_401() {
        for protocols in [None, Some("slop.bearer"), Some("some-other-protocol")] {
            let err = gate(None, protocols).expect_err("missing token must be rejected");
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[test]
    fn rejects_invalid_token_with_401() {
        let err = gate(
            Some("moz-extension://uuid-here"),
            Some("slop.bearer, wrong-token"),
        )
        .expect_err("invalid token must be rejected");
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }
}
