use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Duration};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::error::{Result, SlopError};

use super::types::{ProviderDescriptor, ProviderSource, TransportDescriptor};

pub const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:9339";
pub const DEFAULT_BRIDGE_PATH: &str = "/slop-bridge";
pub const DEFAULT_BRIDGE_URL: &str = "ws://127.0.0.1:9339/slop-bridge";

pub type ProviderChangeCallback = Arc<dyn Fn() + Send + Sync>;
type BridgeFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeProvider {
    pub provider_key: String,
    pub tab_id: u64,
    pub id: String,
    pub name: String,
    pub transport: String,
    pub url: Option<String>,
}

impl BridgeProvider {
    pub fn to_descriptor(&self) -> ProviderDescriptor {
        let transport = if self.transport == "ws" {
            TransportDescriptor {
                transport_type: "ws".to_string(),
                path: None,
                url: self.url.clone(),
            }
        } else {
            TransportDescriptor {
                transport_type: "relay".to_string(),
                path: None,
                url: None,
            }
        };

        ProviderDescriptor {
            id: self.provider_key.clone(),
            name: self.name.clone(),
            slop_version: "1.0".to_string(),
            transport,
            pid: None,
            capabilities: Vec::new(),
            provider_key: Some(self.provider_key.clone()),
            source: ProviderSource::Bridge,
        }
    }
}

pub struct RelaySubscription {
    pub id: u64,
    pub receiver: mpsc::UnboundedReceiver<Value>,
}

pub trait Bridge: Send + Sync {
    fn running(&self) -> bool;
    fn providers(&self) -> Vec<BridgeProvider>;
    fn on_provider_change(&self, callback: ProviderChangeCallback);
    fn subscribe_relay(&self, provider_key: &str) -> RelaySubscription;
    fn unsubscribe_relay(&self, provider_key: &str, subscription_id: u64);
    fn send(&self, message: Value) -> BridgeFuture<Result<()>>;
    fn stop(&self) -> BridgeFuture<()>;
}

#[derive(Clone)]
pub struct BridgeClient {
    inner: Arc<Mutex<BridgeClientInner>>,
}

struct BridgeClientInner {
    url: String,
    retry_delay: Duration,
    dial_timeout: Duration,
    providers: HashMap<String, BridgeProvider>,
    relay_subscribers: HashMap<String, HashMap<u64, mpsc::UnboundedSender<Value>>>,
    next_subscription_id: u64,
    callbacks: Vec<ProviderChangeCallback>,
    writer: Option<mpsc::UnboundedSender<Message>>,
    read_task: Option<JoinHandle<()>>,
    write_task: Option<JoinHandle<()>>,
    reconnect_task: Option<JoinHandle<()>>,
    running: bool,
    started: bool,
}

impl BridgeClient {
    pub fn new(url: &str, retry_delay: Duration, dial_timeout: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(BridgeClientInner {
                url: url.to_string(),
                retry_delay,
                dial_timeout,
                providers: HashMap::new(),
                relay_subscribers: HashMap::new(),
                next_subscription_id: 0,
                callbacks: Vec::new(),
                writer: None,
                read_task: None,
                write_task: None,
                reconnect_task: None,
                running: false,
                started: false,
            })),
        }
    }

    pub async fn connect_once(&self) -> Result<()> {
        let (url, dial_timeout, already_connected) = {
            let inner = self.inner.lock().unwrap();
            (inner.url.clone(), inner.dial_timeout, inner.writer.is_some())
        };
        if already_connected {
            return Ok(());
        }

        let (stream, _) = timeout(dial_timeout, tokio_tungstenite::connect_async(&url))
            .await
            .map_err(|_| SlopError::Transport("bridge client dial timed out".to_string()))?
            .map_err(|e| SlopError::Transport(format!("bridge client connect: {e}")))?;

        let (mut write, mut read) = stream.split();
        let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<Message>();

        let write_task = tokio::spawn(async move {
            while let Some(message) = writer_rx.recv().await {
                if write.send(message).await.is_err() {
                    break;
                }
            }
            let _ = write.close().await;
        });

        let client = self.clone();
        let read_task = tokio::spawn(async move {
            while let Some(Ok(message)) = read.next().await {
                if let Message::Text(text) = message {
                    if let Ok(value) = serde_json::from_str::<Value>(&text) {
                        client.handle_message(value).await;
                    }
                }
            }
            client.handle_disconnect().await;
        });

        let mut inner = self.inner.lock().unwrap();
        inner.writer = Some(writer_tx);
        inner.write_task = Some(write_task);
        inner.read_task = Some(read_task);
        inner.running = true;
        Ok(())
    }

    pub fn start(&self) {
        let client = self.clone();
        tokio::spawn(async move {
            let should_schedule = {
                let mut inner = client.inner.lock().unwrap();
                if inner.started {
                    false
                } else {
                    inner.started = true;
                    inner.writer.is_none()
                }
            };

            if should_schedule {
                client.schedule_reconnect(Duration::from_millis(0));
            }
        });
    }

    fn schedule_reconnect(&self, initial_delay: Duration) {
        let mut inner = self.inner.lock().unwrap();
        if !inner.started || inner.reconnect_task.is_some() {
            return;
        }
        let client = self.clone();
        inner.reconnect_task = Some(tokio::spawn(reconnect_client_loop(client, initial_delay)));
    }

    async fn handle_message(&self, message: Value) {
        match message["type"].as_str().unwrap_or("") {
            "provider-available" => {
                if let Some(provider) = parse_bridge_provider(&message) {
                    let callbacks = {
                        let mut inner = self.inner.lock().unwrap();
                        inner
                            .providers
                            .insert(provider.provider_key.clone(), provider);
                        inner.callbacks.clone()
                    };
                    fire_callbacks(callbacks);
                }
            }
            "provider-unavailable" => {
                if let Some(provider_key) = message["providerKey"].as_str() {
                    let callbacks = {
                        let mut inner = self.inner.lock().unwrap();
                        inner.providers.remove(provider_key);
                        inner.relay_subscribers.remove(provider_key);
                        inner.callbacks.clone()
                    };
                    fire_callbacks(callbacks);
                }
            }
            "slop-relay" => {
                let Some(provider_key) = message["providerKey"].as_str() else {
                    return;
                };
                let Some(payload) = message.get("message") else {
                    return;
                };

                let subscribers = {
                    let inner = self.inner.lock().unwrap();
                    inner
                        .relay_subscribers
                        .get(provider_key)
                        .map(|subs| subs.values().cloned().collect::<Vec<_>>())
                        .unwrap_or_default()
                };

                for subscriber in subscribers {
                    let _ = subscriber.send(payload.clone());
                }
            }
            _ => {}
        }
    }

    async fn handle_disconnect(&self) {
        let (callbacks, should_reconnect, writer_task, read_task) = {
            let mut inner = self.inner.lock().unwrap();
            let providers_changed = !inner.providers.is_empty();
            inner.writer = None;
            inner.running = false;
            inner.providers.clear();
            inner.relay_subscribers.clear();
            let callbacks = if providers_changed {
                inner.callbacks.clone()
            } else {
                Vec::new()
            };
            (
                callbacks,
                inner.started,
                inner.write_task.take(),
                inner.read_task.take(),
            )
        };

        if let Some(task) = writer_task {
            task.abort();
        }
        if let Some(task) = read_task {
            task.abort();
        }

        fire_callbacks(callbacks);

        if should_reconnect {
            let delay = { self.inner.lock().unwrap().retry_delay };
            self.schedule_reconnect(delay);
        }
    }
}

async fn reconnect_client_loop(client: BridgeClient, initial_delay: Duration) {
    if !initial_delay.is_zero() {
        sleep(initial_delay).await;
    }

    loop {
        let (started, connected, retry_delay) = {
            let inner = client.inner.lock().unwrap();
            (inner.started, inner.writer.is_some(), inner.retry_delay)
        };
        if !started || connected {
            break;
        }

        if client.connect_once().await.is_ok() {
            break;
        }

        sleep(retry_delay).await;
    }

    let mut inner = client.inner.lock().unwrap();
    inner.reconnect_task = None;
}

impl Bridge for BridgeClient {
    fn running(&self) -> bool {
        self.inner.lock().unwrap().running
    }

    fn providers(&self) -> Vec<BridgeProvider> {
        self.inner
            .lock()
            .unwrap()
            .providers
            .values()
            .cloned()
            .collect()
    }

    fn on_provider_change(&self, callback: ProviderChangeCallback) {
        self.inner.lock().unwrap().callbacks.push(callback);
    }

    fn subscribe_relay(&self, provider_key: &str) -> RelaySubscription {
        let mut inner = self.inner.lock().unwrap();
        inner.next_subscription_id += 1;
        let subscription_id = inner.next_subscription_id;
        let (tx, rx) = mpsc::unbounded_channel();
        inner
            .relay_subscribers
            .entry(provider_key.to_string())
            .or_default()
            .insert(subscription_id, tx);

        RelaySubscription {
            id: subscription_id,
            receiver: rx,
        }
    }

    fn unsubscribe_relay(&self, provider_key: &str, subscription_id: u64) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(subs) = inner.relay_subscribers.get_mut(provider_key) {
            subs.remove(&subscription_id);
            if subs.is_empty() {
                inner.relay_subscribers.remove(provider_key);
            }
        }
    }

    fn send(&self, message: Value) -> BridgeFuture<Result<()>> {
        let client = self.clone();
        Box::pin(async move {
            let text = serde_json::to_string(&message)?;
            let writer = client
                .inner
                .lock()
                .unwrap()
                .writer
                .clone()
                .ok_or_else(|| SlopError::Transport("bridge client is not connected".to_string()))?;
            writer
                .send(Message::Text(text.into()))
                .map_err(|e| SlopError::Transport(format!("bridge send failed: {e}")))
        })
    }

    fn stop(&self) -> BridgeFuture<()> {
        let client = self.clone();
        Box::pin(async move {
            let (writer_task, read_task, reconnect_task) = {
                let mut inner = client.inner.lock().unwrap();
                inner.started = false;
                inner.running = false;
                inner.writer = None;
                inner.providers.clear();
                inner.relay_subscribers.clear();
                (
                    inner.write_task.take(),
                    inner.read_task.take(),
                    inner.reconnect_task.take(),
                )
            };

            if let Some(task) = writer_task {
                task.abort();
            }
            if let Some(task) = read_task {
                task.abort();
            }
            if let Some(task) = reconnect_task {
                task.abort();
            }
        })
    }
}

#[derive(Clone)]
pub struct BridgeServer {
    inner: Arc<Mutex<BridgeServerInner>>,
}

struct BridgeServerInner {
    addr: String,
    path: String,
    actual_addr: Option<String>,
    providers: HashMap<String, BridgeProvider>,
    relay_subscribers: HashMap<String, HashMap<u64, mpsc::UnboundedSender<Value>>>,
    next_subscription_id: u64,
    next_sink_id: u64,
    sinks: HashMap<u64, mpsc::UnboundedSender<Message>>,
    callbacks: Vec<ProviderChangeCallback>,
    accept_task: Option<JoinHandle<()>>,
    running: bool,
}

impl BridgeServer {
    pub fn new(addr: &str, path: &str) -> Self {
        Self {
            inner: Arc::new(Mutex::new(BridgeServerInner {
                addr: addr.to_string(),
                path: path.to_string(),
                actual_addr: None,
                providers: HashMap::new(),
                relay_subscribers: HashMap::new(),
                next_subscription_id: 0,
                next_sink_id: 0,
                sinks: HashMap::new(),
                callbacks: Vec::new(),
                accept_task: None,
                running: false,
            })),
        }
    }

    pub async fn start(&self) -> Result<()> {
        let (addr, path, already_running) = {
            let inner = self.inner.lock().unwrap();
            (inner.addr.clone(), inner.path.clone(), inner.running)
        };
        if already_running {
            return Ok(());
        }

        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| SlopError::Transport(format!("bridge bind failed: {e}")))?;
        let actual_addr = listener
            .local_addr()
            .map(|addr| addr.to_string())
            .map_err(|e| SlopError::Transport(format!("bridge local_addr failed: {e}")))?;

        let server = self.clone();
        let accept_task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let server = server.clone();
                let path = path.clone();
                tokio::spawn(async move {
                    let Ok(ws_stream) = accept_async(stream).await else {
                        return;
                    };

                    let (mut write, mut read) = ws_stream.split();
                    let (sink_tx, mut sink_rx) = mpsc::unbounded_channel::<Message>();
                    let replay_sink = sink_tx.clone();

                    let (sink_id, providers) = {
                        let mut inner = server.inner.lock().unwrap();
                        inner.next_sink_id += 1;
                        let sink_id = inner.next_sink_id;
                        inner.sinks.insert(sink_id, sink_tx);
                        let providers = inner.providers.values().cloned().collect::<Vec<_>>();
                        (sink_id, providers)
                    };

                    let writer_task = tokio::spawn(async move {
                        while let Some(message) = sink_rx.recv().await {
                            if write.send(message).await.is_err() {
                                break;
                            }
                        }
                        let _ = write.close().await;
                    });

                    for provider in providers {
                        let announce = json!({
                            "type": "provider-available",
                            "tabId": provider.tab_id,
                            "providerKey": provider.provider_key,
                            "provider": {
                                "id": provider.id,
                                "name": provider.name,
                                "transport": provider.transport,
                                "url": provider.url,
                            }
                        });
                        if let Ok(text) = serde_json::to_string(&announce) {
                            let _ = replay_sink.send(Message::Text(text.into()));
                        }
                    }

                    while let Some(Ok(message)) = read.next().await {
                        if let Message::Text(text) = message {
                            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                                let _ = server.handle_message(value).await;
                            }
                        }
                    }

                    writer_task.abort();
                    let callbacks = server.remove_sink(sink_id).await;
                    fire_callbacks(callbacks);
                    let _ = path;
                });
            }
        });

        let mut inner = self.inner.lock().unwrap();
        inner.actual_addr = Some(actual_addr);
        inner.accept_task = Some(accept_task);
        inner.running = true;
        Ok(())
    }

    pub async fn url(&self) -> String {
        let inner = self.inner.lock().unwrap();
        format!(
            "ws://{}{}",
            inner
                .actual_addr
                .clone()
                .unwrap_or_else(|| inner.addr.clone()),
            inner.path
        )
    }

    async fn handle_message(&self, message: Value) -> Result<()> {
        match message["type"].as_str().unwrap_or("") {
            "provider-available" => {
                if let Some(provider) = parse_bridge_provider(&message) {
                    let callbacks = {
                        let mut inner = self.inner.lock().unwrap();
                        inner
                            .providers
                            .insert(provider.provider_key.clone(), provider);
                        inner.callbacks.clone()
                    };
                    self.broadcast(&message).await?;
                    fire_callbacks(callbacks);
                }
            }
            "provider-unavailable" => {
                if let Some(provider_key) = message["providerKey"].as_str() {
                    let callbacks = {
                        let mut inner = self.inner.lock().unwrap();
                        inner.providers.remove(provider_key);
                        inner.relay_subscribers.remove(provider_key);
                        inner.callbacks.clone()
                    };
                    self.broadcast(&message).await?;
                    fire_callbacks(callbacks);
                }
            }
            "slop-relay" => {
                let Some(provider_key) = message["providerKey"].as_str() else {
                    return Ok(());
                };
                let Some(payload) = message.get("message") else {
                    return Ok(());
                };
                self.dispatch_relay(provider_key, payload.clone()).await;
                self.broadcast(&message).await?;
            }
            "relay-open" | "relay-close" => {
                self.broadcast(&message).await?;
            }
            _ => {}
        }

        Ok(())
    }

    async fn broadcast(&self, message: &Value) -> Result<()> {
        let text = serde_json::to_string(message)?;
        let sinks = {
            let inner = self.inner.lock().unwrap();
            inner
                .sinks
                .iter()
                .map(|(id, sink)| (*id, sink.clone()))
                .collect::<Vec<_>>()
        };

        let mut failed = Vec::new();
        for (sink_id, sink) in sinks {
            if sink.send(Message::Text(text.clone().into())).is_err() {
                failed.push(sink_id);
            }
        }

        if !failed.is_empty() {
            let mut inner = self.inner.lock().unwrap();
            for sink_id in failed {
                inner.sinks.remove(&sink_id);
            }
        }

        Ok(())
    }

    async fn dispatch_relay(&self, provider_key: &str, message: Value) {
        let subscribers = {
            let inner = self.inner.lock().unwrap();
            inner
                .relay_subscribers
                .get(provider_key)
                .map(|subs| subs.values().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        };

        for subscriber in subscribers {
            let _ = subscriber.send(message.clone());
        }
    }

    async fn remove_sink(&self, sink_id: u64) -> Vec<ProviderChangeCallback> {
        let mut inner = self.inner.lock().unwrap();
        inner.sinks.remove(&sink_id);
        if !inner.sinks.is_empty() {
            return Vec::new();
        }

        let providers_changed = !inner.providers.is_empty();
        inner.providers.clear();
        inner.relay_subscribers.clear();
        if providers_changed {
            inner.callbacks.clone()
        } else {
            Vec::new()
        }
    }
}

impl Bridge for BridgeServer {
    fn running(&self) -> bool {
        self.inner.lock().unwrap().running
    }

    fn providers(&self) -> Vec<BridgeProvider> {
        self.inner
            .lock()
            .unwrap()
            .providers
            .values()
            .cloned()
            .collect()
    }

    fn on_provider_change(&self, callback: ProviderChangeCallback) {
        self.inner.lock().unwrap().callbacks.push(callback);
    }

    fn subscribe_relay(&self, provider_key: &str) -> RelaySubscription {
        let mut inner = self.inner.lock().unwrap();
        inner.next_subscription_id += 1;
        let subscription_id = inner.next_subscription_id;
        let (tx, rx) = mpsc::unbounded_channel();
        inner
            .relay_subscribers
            .entry(provider_key.to_string())
            .or_default()
            .insert(subscription_id, tx);

        RelaySubscription {
            id: subscription_id,
            receiver: rx,
        }
    }

    fn unsubscribe_relay(&self, provider_key: &str, subscription_id: u64) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(subs) = inner.relay_subscribers.get_mut(provider_key) {
            subs.remove(&subscription_id);
            if subs.is_empty() {
                inner.relay_subscribers.remove(provider_key);
            }
        }
    }

    fn send(&self, message: Value) -> BridgeFuture<Result<()>> {
        let server = self.clone();
        Box::pin(async move { server.broadcast(&message).await })
    }

    fn stop(&self) -> BridgeFuture<()> {
        let server = self.clone();
        Box::pin(async move {
            let accept_task = {
                let mut inner = server.inner.lock().unwrap();
                inner.running = false;
                inner.providers.clear();
                inner.relay_subscribers.clear();
                inner.sinks.clear();
                inner.accept_task.take()
            };

            if let Some(task) = accept_task {
                task.abort();
            }
        })
    }
}

fn fire_callbacks(callbacks: Vec<ProviderChangeCallback>) {
    for callback in callbacks {
        callback();
    }
}

fn parse_bridge_provider(message: &Value) -> Option<BridgeProvider> {
    let provider_key = message["providerKey"].as_str()?.to_string();
    let tab_id = message["tabId"].as_u64().unwrap_or(0);
    let provider = message["provider"].as_object();

    let id = provider
        .and_then(|provider| provider.get("id"))
        .and_then(Value::as_str)
        .unwrap_or(&provider_key)
        .to_string();
    let name = provider
        .and_then(|provider| provider.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Tab")
        .to_string();
    let transport = provider
        .and_then(|provider| provider.get("transport"))
        .and_then(Value::as_str)
        .unwrap_or("postmessage")
        .to_string();
    let url = provider
        .and_then(|provider| provider.get("url"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    Some(BridgeProvider {
        provider_key,
        tab_id,
        id,
        name,
        transport,
        url,
    })
}
