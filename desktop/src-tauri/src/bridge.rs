//! Local WebSocket bridge server at ws://localhost:9339/slop-bridge
//!
//! The extension connects here to:
//! 1. Announce discovered browser providers
//! 2. Relay SLOP messages for SPA providers (postMessage-based)

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

const BRIDGE_PORT: u16 = 9339;

/// Shared state: connected extension WebSocket sinks for sending messages back
pub struct BridgeSinks(pub Arc<Mutex<Vec<Arc<Mutex<futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message,
>>>>>>);

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
            println!("Bridge: extension disconnected");
        });
    }
}

/// Send a message to the extension via the bridge
#[tauri::command]
pub async fn bridge_send(app: AppHandle, message: Value) -> Result<(), String> {
    let sinks_state = app.try_state::<BridgeSinks>();
    let sinks = match sinks_state {
        Some(s) => s,
        None => return Err("Bridge not running".into()),
    };

    let text = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    let sinks = sinks.0.lock().await;

    for sink in sinks.iter() {
        let mut s = sink.lock().await;
        let _ = s.send(Message::Text(text.clone())).await;
    }

    Ok(())
}
