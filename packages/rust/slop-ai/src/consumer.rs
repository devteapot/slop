//! Async SLOP consumer — connects to a provider, mirrors state, and dispatches
//! actions via a channel-based transport abstraction.
//!
//! Gated behind the `native` feature (requires tokio).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::error::{Result, SlopError};
use crate::state_mirror::StateMirror;
use crate::types::{PatchOp, SlopNode};

// ---------------------------------------------------------------------------
// Transport trait
// ---------------------------------------------------------------------------

/// Client transport — implementors provide a pair of unbounded channels upon
/// connection.  The consumer sends JSON messages to the provider via the
/// sender and receives messages via the receiver.
pub trait ClientTransport: Send + Sync {
    /// Establish a connection, returning `(sender, receiver)`.
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
    >;
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

/// A SLOP consumer that connects to a provider, maintains local state mirrors,
/// and exposes subscribe / query / invoke operations.
///
/// All public methods are `&self` — interior mutability via `Arc<Mutex<..>>`.
pub struct SlopConsumer {
    inner: Arc<Mutex<ConsumerInner>>,
}

struct ConsumerInner {
    sender: Option<mpsc::UnboundedSender<Value>>,
    mirrors: HashMap<String, StateMirror>,
    pending: HashMap<String, oneshot::Sender<Value>>,
    sub_counter: u32,
    req_counter: u32,
    patch_callbacks: Vec<Arc<dyn Fn(&str, &[PatchOp], u64) + Send + Sync>>,
    disconnect_callbacks: Vec<Arc<dyn Fn() + Send + Sync>>,
}

impl SlopConsumer {
    /// Create a new, disconnected consumer.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ConsumerInner {
                sender: None,
                mirrors: HashMap::new(),
                pending: HashMap::new(),
                sub_counter: 0,
                req_counter: 0,
                patch_callbacks: Vec::new(),
                disconnect_callbacks: Vec::new(),
            })),
        }
    }

    /// Connect to a provider using the given transport.
    ///
    /// Returns the `hello` message from the provider.
    pub async fn connect(&self, transport: &dyn ClientTransport) -> Result<Value> {
        let (tx, mut rx) = transport.connect().await?;

        {
            let mut inner = self.inner.lock().await;
            inner.sender = Some(tx);
        }

        // Wait for the hello message.
        let hello = rx
            .recv()
            .await
            .ok_or(SlopError::ConnectionClosed)?;

        // Spawn the read loop.
        let inner_ref = Arc::clone(&self.inner);
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                Self::dispatch(Arc::clone(&inner_ref), msg).await;
            }
            // Connection closed — fire disconnect callbacks.
            let inner = inner_ref.lock().await;
            for cb in &inner.disconnect_callbacks {
                cb();
            }
        });

        Ok(hello)
    }

    /// Subscribe to a path and receive the initial snapshot.
    ///
    /// Returns `(subscription_id, tree)`.
    pub async fn subscribe(&self, path: &str, depth: i32) -> Result<(String, SlopNode)> {
        let (sub_id, rx) = {
            let mut inner = self.inner.lock().await;
            inner.sub_counter += 1;
            let sub_id = format!("sub-{}", inner.sub_counter);
            let (tx, rx) = oneshot::channel();
            inner.pending.insert(sub_id.clone(), tx);
            self.send_inner(
                &inner,
                json!({
                    "type": "subscribe",
                    "id": sub_id,
                    "path": path,
                    "depth": depth,
                }),
            )?;
            (sub_id, rx)
        };

        let snapshot = rx.await.map_err(|_| SlopError::ConnectionClosed)?;
        let version = snapshot["version"].as_u64().unwrap_or(0);
        let tree: SlopNode =
            serde_json::from_value(snapshot["tree"].clone()).map_err(SlopError::Serialization)?;

        {
            let mut inner = self.inner.lock().await;
            inner.mirrors.insert(sub_id.clone(), StateMirror::new(tree.clone(), version));
        }

        Ok((sub_id, tree))
    }

    /// Unsubscribe from a subscription.
    pub async fn unsubscribe(&self, id: &str) {
        let mut inner = self.inner.lock().await;
        inner.mirrors.remove(id);
        let _ = self.send_inner(
            &inner,
            json!({"type": "unsubscribe", "id": id}),
        );
    }

    /// One-shot query of the tree at a path.
    pub async fn query(&self, path: &str, depth: i32) -> Result<SlopNode> {
        let (req_id, rx) = {
            let mut inner = self.inner.lock().await;
            inner.req_counter += 1;
            let req_id = format!("q-{}", inner.req_counter);
            let (tx, rx) = oneshot::channel();
            inner.pending.insert(req_id.clone(), tx);
            self.send_inner(
                &inner,
                json!({
                    "type": "query",
                    "id": req_id,
                    "path": path,
                    "depth": depth,
                }),
            )?;
            (req_id, rx)
        };

        let snapshot = rx.await.map_err(|_| SlopError::ConnectionClosed)?;
        let tree: SlopNode =
            serde_json::from_value(snapshot["tree"].clone()).map_err(SlopError::Serialization)?;
        Ok(tree)
    }

    /// Invoke an action on the provider.
    pub async fn invoke(
        &self,
        path: &str,
        action: &str,
        params: Option<Value>,
    ) -> Result<Value> {
        let (req_id, rx) = {
            let mut inner = self.inner.lock().await;
            inner.req_counter += 1;
            let req_id = format!("inv-{}", inner.req_counter);
            let (tx, rx) = oneshot::channel();
            inner.pending.insert(req_id.clone(), tx);
            let mut msg = json!({
                "type": "invoke",
                "id": req_id,
                "path": path,
                "action": action,
            });
            if let Some(p) = params {
                msg["params"] = p;
            }
            self.send_inner(&inner, msg)?;
            (req_id, rx)
        };

        let result = rx.await.map_err(|_| SlopError::ConnectionClosed)?;
        if result["status"] == "error" {
            return Err(SlopError::ActionFailed {
                code: result["error"]["code"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string(),
                message: result["error"]["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string(),
            });
        }
        Ok(result)
    }

    /// Get a clone of the current tree for a subscription.
    pub async fn tree(&self, subscription_id: &str) -> Option<SlopNode> {
        let inner = self.inner.lock().await;
        inner
            .mirrors
            .get(subscription_id)
            .map(|m| m.tree().clone())
    }

    /// Disconnect from the provider.
    pub async fn disconnect(&self) {
        let mut inner = self.inner.lock().await;
        inner.sender = None;
        inner.mirrors.clear();
        inner.pending.clear();
    }

    /// Register a callback for patch events.
    pub async fn on_patch<F>(&self, callback: F)
    where
        F: Fn(&str, &[PatchOp], u64) + Send + Sync + 'static,
    {
        let mut inner = self.inner.lock().await;
        inner.patch_callbacks.push(Arc::new(callback));
    }

    /// Register a callback for disconnect events.
    pub async fn on_disconnect<F>(&self, callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        let mut inner = self.inner.lock().await;
        inner.disconnect_callbacks.push(Arc::new(callback));
    }

    // -- internals --

    fn send_inner(
        &self,
        inner: &ConsumerInner,
        msg: Value,
    ) -> Result<()> {
        inner
            .sender
            .as_ref()
            .ok_or(SlopError::ConnectionClosed)?
            .send(msg)
            .map_err(|e| SlopError::Transport(e.to_string()))
    }

    async fn dispatch(inner: Arc<Mutex<ConsumerInner>>, msg: Value) {
        let msg_type = msg["type"].as_str().unwrap_or("");
        let msg_id = msg["id"].as_str().unwrap_or("").to_string();

        match msg_type {
            "snapshot" => {
                // Resolve the pending request if any.
                let mut locked = inner.lock().await;
                if let Some(tx) = locked.pending.remove(&msg_id) {
                    let _ = tx.send(msg.clone());
                }
                // If we have a mirror for this subscription, update it.
                if let Some(mirror) = locked.mirrors.get_mut(&msg_id) {
                    let version = msg["version"].as_u64().unwrap_or(0);
                    if let Ok(tree) = serde_json::from_value::<SlopNode>(msg["tree"].clone()) {
                        *mirror = StateMirror::new(tree, version);
                    }
                }
            }
            "patch" => {
                let sub_id = msg["subscription"].as_str().unwrap_or(&msg_id).to_string();
                let mut locked = inner.lock().await;
                let version = msg["version"].as_u64().unwrap_or(0);
                let ops: Vec<PatchOp> = msg["ops"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| serde_json::from_value(v.clone()).ok())
                            .collect()
                    })
                    .unwrap_or_default();

                if let Some(mirror) = locked.mirrors.get_mut(&sub_id) {
                    mirror.apply_patch(&ops, version);
                }

                // Fire patch callbacks.
                let callbacks: Vec<_> = locked.patch_callbacks.clone();
                drop(locked);
                for cb in &callbacks {
                    cb(&sub_id, &ops, version);
                }
            }
            "result" => {
                let mut locked = inner.lock().await;
                if let Some(tx) = locked.pending.remove(&msg_id) {
                    let _ = tx.send(msg);
                }
            }
            _ => {}
        }
    }
}

impl Default for SlopConsumer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// A mock transport that uses in-memory channels.
    struct MockTransport {
        /// Messages the "provider" will send to the consumer.
        provider_messages: Vec<Value>,
    }

    impl ClientTransport for MockTransport {
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
            let messages = self.provider_messages.clone();
            Box::pin(async move {
                let (consumer_tx, _consumer_rx) = mpsc::unbounded_channel();
                let (provider_tx, provider_rx) = mpsc::unbounded_channel();

                // Send all provider messages.
                for msg in messages {
                    provider_tx.send(msg).unwrap();
                }

                Ok((consumer_tx, provider_rx))
            })
        }
    }

    #[tokio::test]
    async fn test_connect_hello() {
        let transport = MockTransport {
            provider_messages: vec![json!({
                "type": "hello",
                "provider": {"id": "app", "name": "App", "slop_version": "0.1"}
            })],
        };

        let consumer = SlopConsumer::new();
        let hello = consumer.connect(&transport).await.unwrap();
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["provider"]["id"], "app");
    }

    #[tokio::test]
    async fn test_disconnect_callback() {
        let called = Arc::new(AtomicBool::new(false));
        let called_clone = called.clone();

        let consumer = SlopConsumer::new();
        consumer
            .on_disconnect(move || {
                called_clone.store(true, Ordering::SeqCst);
            })
            .await;

        // The callback is registered.
        let inner = consumer.inner.lock().await;
        assert_eq!(inner.disconnect_callbacks.len(), 1);
    }

    #[tokio::test]
    async fn test_patch_callback() {
        let consumer = SlopConsumer::new();
        let patch_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let pc = patch_count.clone();
        consumer
            .on_patch(move |_sub, _ops, _v| {
                pc.fetch_add(1, Ordering::SeqCst);
            })
            .await;

        let inner = consumer.inner.lock().await;
        assert_eq!(inner.patch_callbacks.len(), 1);
    }

    #[tokio::test]
    async fn test_new_default() {
        let c1 = SlopConsumer::new();
        let c2 = SlopConsumer::default();
        let inner1 = c1.inner.lock().await;
        let inner2 = c2.inner.lock().await;
        assert!(inner1.sender.is_none());
        assert!(inner2.sender.is_none());
    }
}
