use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::consumer::ClientTransport;
use crate::error::{Result, SlopError};

use super::bridge::{Bridge, BridgeServer, ProviderChangeCallback, RelaySubscription};
use super::relay_transport::BridgeRelayTransport;
use super::service::DiscoveryService;
use super::types::DiscoveryServiceOptions;

#[tokio::test]
async fn service_scans_and_prunes_descriptors() {
    let providers_dir = temp_dir("slop-rust-discovery-scan");
    std::fs::create_dir_all(&providers_dir).unwrap();
    let descriptor_path = providers_dir.join("test-app.json");
    std::fs::write(
        &descriptor_path,
        r#"{
  "id": "test-app",
  "name": "Test App",
  "slop_version": "0.1",
  "transport": {"type": "unix", "path": "/tmp/slop/test-app.sock"},
  "capabilities": ["state"]
}"#,
    )
    .unwrap();

    let service = DiscoveryService::new(DiscoveryServiceOptions {
        providers_dirs: vec![providers_dir.clone()],
        host_bridge: false,
        bridge_url: "ws://127.0.0.1:1/slop-bridge".to_string(),
        bridge_dial_timeout: Duration::from_millis(50),
        bridge_retry_delay: Duration::from_millis(50),
        scan_interval: Duration::from_millis(50),
        watch_interval: Duration::from_millis(20),
        ..DiscoveryServiceOptions::default()
    });

    service.start().await;
    wait_until(Duration::from_secs(1), || {
        let service = service.clone();
        async move { service.get_discovered().await.len() == 1 }
    })
    .await;

    std::fs::remove_file(&descriptor_path).unwrap();

    wait_until(Duration::from_secs(1), || {
        let service = service.clone();
        async move { service.get_discovered().await.is_empty() }
    })
    .await;

    service.stop().await;
    let _ = std::fs::remove_dir_all(&providers_dir);
}

#[tokio::test]
async fn bridge_server_forwards_relay_control_messages() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let server = BridgeServer::new(&format!("127.0.0.1:{port}"), "/slop-bridge");
    server.start().await.unwrap();
    let url = format!("ws://127.0.0.1:{port}/slop-bridge");

    let (mut client_one, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut client_two, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    client_one
        .send(Message::Text(
            json!({"type": "relay-open", "providerKey": "tab-1"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let open = read_text_message(&mut client_two).await;
    assert_eq!(open["type"], "relay-open");

    client_one
        .send(Message::Text(
            json!({"type": "relay-close", "providerKey": "tab-1"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let close = read_text_message(&mut client_two).await;
    assert_eq!(close["type"], "relay-close");

    let _ = client_one.close(None).await;
    let _ = client_two.close(None).await;
    server.stop().await;
}

#[tokio::test]
async fn relay_transport_buffers_early_messages() {
    let bridge: Arc<dyn Bridge> = Arc::new(FakeBridge::default());
    let transport = BridgeRelayTransport::new(bridge, "tab-1");

    let (_tx, mut rx) = transport.connect().await.unwrap();
    let hello = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(hello["type"], "hello");
}

async fn wait_until<F, Fut>(timeout_duration: Duration, mut check: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = tokio::time::Instant::now() + timeout_duration;
    loop {
        if check().await {
            return;
        }
        assert!(tokio::time::Instant::now() < deadline, "condition not met before timeout");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn read_text_message<S>(stream: &mut S) -> Value
where
    S: StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    while let Some(Ok(message)) = stream.next().await {
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).unwrap();
        }
    }
    panic!("expected text message")
}

fn temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}

#[derive(Default)]
struct FakeBridge {
    subscribers: Mutex<HashMap<String, HashMap<u64, mpsc::UnboundedSender<Value>>>>,
    next_subscription_id: Mutex<u64>,
}

impl Bridge for FakeBridge {
    fn running(&self) -> bool {
        true
    }

    fn providers(&self) -> Vec<super::BridgeProvider> {
        Vec::new()
    }

    fn on_provider_change(&self, _callback: ProviderChangeCallback) {}

    fn subscribe_relay(&self, provider_key: &str) -> RelaySubscription {
        let mut next = self.next_subscription_id.lock().unwrap();
        *next += 1;
        let subscription_id = *next;
        let (tx, rx) = mpsc::unbounded_channel();
        self.subscribers
            .lock()
            .unwrap()
            .entry(provider_key.to_string())
            .or_default()
            .insert(subscription_id, tx);

        RelaySubscription {
            id: subscription_id,
            receiver: rx,
        }
    }

    fn unsubscribe_relay(&self, provider_key: &str, subscription_id: u64) {
        if let Some(subscribers) = self.subscribers.lock().unwrap().get_mut(provider_key) {
            subscribers.remove(&subscription_id);
        }
    }

    fn send(&self, message: Value) -> Pin<Box<dyn Future<Output = Result<()>> + Send>> {
        let subscribers = self.subscribers.lock().unwrap().clone();
        Box::pin(async move {
            if message["type"] == "slop-relay" && message["message"]["type"] == "connect" {
                let provider_key = message["providerKey"]
                    .as_str()
                    .ok_or_else(|| SlopError::Transport("missing provider key".to_string()))?;
                if let Some(listeners) = subscribers.get(provider_key) {
                    for sender in listeners.values() {
                        let _ = sender.send(json!({"type": "hello", "provider": {"name": "Browser App"}}));
                    }
                }
            }
            Ok(())
        })
    }

    fn stop(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async {})
    }
}
