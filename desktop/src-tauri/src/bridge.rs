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

const BRIDGE_PORT: u16 = 9339;

/// Shared state: connected extension WebSocket sinks for sending messages back
pub struct BridgeSinks(pub Arc<Mutex<Vec<Arc<Mutex<futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message,
>>>>>>);

/// Subscribers for provider-scoped relay messages coming back from the extension.
pub struct RelaySubscribers(pub Arc<Mutex<HashMap<String, Vec<mpsc::UnboundedSender<Value>>>>>);

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

    let sinks: Arc<Mutex<Vec<Arc<Mutex<futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
        Message,
    >>>>>> = Arc::new(Mutex::new(Vec::new()));

    // Store sinks in Tauri state so commands can send to extension
    let bridge_sinks = BridgeSinks(sinks.clone());
    app.manage(bridge_sinks);
    let relay_subscribers = RelaySubscribers(Arc::new(Mutex::new(HashMap::new())));
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

            println!("Bridge: extension connected");
            let (write, mut read) = ws_stream.split();
            let write = Arc::new(Mutex::new(write));

            // Add to sinks
            sinks_clone.lock().await.push(write.clone());

            // Read messages from extension
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            if value["type"] == "slop-relay" {
                                if let (Some(provider_key), Some(message)) = (
                                    value["providerKey"].as_str(),
                                    value.get("message"),
                                ) {
                                    dispatch_relay(
                                        &app_clone,
                                        provider_key,
                                        message.clone(),
                                    )
                                    .await;
                                }
                            }

                            if value["type"] == "provider-unavailable" {
                                if let Some(provider_key) = value["providerKey"].as_str() {
                                    close_relay(&app_clone, provider_key).await;
                                }
                            }

                            // Emit to frontend as a Tauri event
                            let _ = app_clone.emit("bridge-message", value);
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
            }
            println!("Bridge: extension disconnected");
        });
    }
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

/// Send a message to the extension via the bridge
#[tauri::command]
pub async fn bridge_send(app: AppHandle, message: Value) -> Result<(), String> {
    bridge_send_value(app, message).await
}
