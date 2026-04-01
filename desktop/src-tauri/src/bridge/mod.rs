//! Local WebSocket bridge server at ws://localhost:9339/slop-bridge
//!
//! The extension connects here to:
//! 1. Announce discovered browser providers
//! 2. Relay SLOP messages for SPA providers (postMessage-based)

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::events;
use crate::provider::{ProviderRegistry, ProviderSummary};

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
            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    eprintln!("Bridge: WebSocket handshake failed: {}", e);
                    return;
                }
            };

            let (write, mut read) = ws_stream.split();
            let write = Arc::new(Mutex::new(write));

            sinks_clone.lock().await.push(write.clone());
            let _ = app_clone.emit("bridge-status", true);

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

async fn handle_bridge_message(app: &AppHandle, value: &Value) {
    let msg_type = value["type"].as_str().unwrap_or("");

    match msg_type {
        "slop-relay" => {
            if let (Some(provider_key), Some(message)) =
                (value["providerKey"].as_str(), value.get("message"))
            {
                dispatch_relay(app, provider_key, message.clone()).await;
            }
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
        }
        "provider-unavailable" => {
            if let Some(provider_key) = value["providerKey"].as_str() {
                close_relay(app, provider_key).await;
                events::emit_provider_removed(app, provider_key.to_string());
                if let Some(registry) = app.try_state::<Arc<Mutex<ProviderRegistry>>>() {
                    registry.lock().await.remove_entry(provider_key);
                }
            }
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
