use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};

use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};

use crate::consumer::ClientTransport;
use crate::error::{Result, SlopError};

use super::bridge::Bridge;

pub struct BridgeRelayTransport {
    bridge: Arc<dyn Bridge>,
    provider_key: String,
}

impl BridgeRelayTransport {
    pub fn new(bridge: Arc<dyn Bridge>, provider_key: impl Into<String>) -> Self {
        Self {
            bridge,
            provider_key: provider_key.into(),
        }
    }
}

impl ClientTransport for BridgeRelayTransport {
    fn connect(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<(mpsc::UnboundedSender<Value>, mpsc::UnboundedReceiver<Value>)>> + Send>> {
        let bridge = Arc::clone(&self.bridge);
        let provider_key = self.provider_key.clone();

        Box::pin(async move {
            let subscription = bridge.subscribe_relay(&provider_key);
            bridge
                .send(json!({
                    "type": "relay-open",
                    "providerKey": provider_key.clone(),
                }))
                .await?;

            let got_response = Arc::new(AtomicBool::new(false));

            let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<Value>();
            let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<Value>();

            let send_bridge = Arc::clone(&bridge);
            let send_key = provider_key.clone();
            let close_key = provider_key.clone();
            let subscription_id = subscription.id;
            tokio::spawn(async move {
                while let Some(msg) = outgoing_rx.recv().await {
                    let _ = send_bridge
                        .send(json!({
                            "type": "slop-relay",
                            "providerKey": send_key.clone(),
                            "message": msg,
                        }))
                        .await;
                }

                let _ = send_bridge
                    .send(json!({
                        "type": "relay-close",
                        "providerKey": close_key.clone(),
                    }))
                    .await;
                send_bridge.unsubscribe_relay(&close_key, subscription_id);
            });

            let recv_bridge = Arc::clone(&bridge);
            let recv_key = provider_key.clone();
            let recv_subscription_id = subscription.id;
            let response_seen = Arc::clone(&got_response);
            let mut relay_rx = subscription.receiver;
            tokio::spawn(async move {
                while let Some(message) = relay_rx.recv().await {
                    response_seen.store(true, Ordering::SeqCst);
                    if incoming_tx.send(message).is_err() {
                        break;
                    }
                }
                recv_bridge.unsubscribe_relay(&recv_key, recv_subscription_id);
            });

            for _ in 0..=3 {
                bridge
                    .send(json!({
                        "type": "slop-relay",
                        "providerKey": provider_key.clone(),
                        "message": {"type": "connect"},
                    }))
                    .await?;

                if got_response.load(Ordering::SeqCst) {
                    break;
                }

                sleep(Duration::from_millis(300)).await;
            }

            if outgoing_tx.is_closed() {
                return Err(SlopError::Transport("relay connection closed".to_string()));
            }

            Ok((outgoing_tx, incoming_rx))
        })
    }
}
