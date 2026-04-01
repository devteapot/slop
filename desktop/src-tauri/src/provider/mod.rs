pub mod connection;
pub mod discovery;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use slop_ai::{ClientTransport, SlopConsumer, SlopError, SlopNode, UnixClientTransport, WsClientTransport};
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

use crate::bridge;
use crate::events::{self, ProviderStatusPayload};
use connection::ActiveConnection;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderSource {
    Discovered,
    Manual,
    Bridge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TransportConfig {
    #[serde(rename = "ws")]
    Ws { url: String },
    #[serde(rename = "unix")]
    Unix { path: String },
    #[serde(rename = "relay")]
    Relay { provider_key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderEntry {
    pub id: String,
    pub name: String,
    pub transport: TransportConfig,
    pub source: ProviderSource,
    pub status: ConnectionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge_tab_id: Option<u64>,
}

/// Summary sent to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSummary {
    pub id: String,
    pub name: String,
    pub transport_type: String,
    pub source: ProviderSource,
    pub status: ConnectionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
}

impl From<&ProviderEntry> for ProviderSummary {
    fn from(entry: &ProviderEntry) -> Self {
        Self {
            id: entry.id.clone(),
            name: entry.name.clone(),
            transport_type: match &entry.transport {
                TransportConfig::Ws { .. } => "ws".to_string(),
                TransportConfig::Unix { .. } => "unix".to_string(),
                TransportConfig::Relay { .. } => "relay".to_string(),
            },
            source: entry.source.clone(),
            status: entry.status.clone(),
            provider_name: entry.provider_name.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderConnectResult {
    pub provider_name: String,
    pub tree: SlopNode,
}

/// Registry of all known providers and their active connections.
pub struct ProviderRegistry {
    pub entries: HashMap<String, ProviderEntry>,
    pub connections: HashMap<String, Arc<ActiveConnection>>,
}

impl ProviderRegistry {
    pub fn new() -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            entries: HashMap::new(),
            connections: HashMap::new(),
        }))
    }

    pub fn list_summaries(&self) -> Vec<ProviderSummary> {
        self.entries.values().map(ProviderSummary::from).collect()
    }

    pub fn add_entry(&mut self, entry: ProviderEntry) {
        self.entries.insert(entry.id.clone(), entry);
    }

    pub fn remove_entry(&mut self, id: &str) {
        self.entries.remove(id);
        self.connections.remove(id);
    }

    pub fn get_entry(&self, id: &str) -> Option<&ProviderEntry> {
        self.entries.get(id)
    }

    pub fn get_connection(&self, id: &str) -> Option<Arc<ActiveConnection>> {
        self.connections.get(id).cloned()
    }

    /// Register an active connection.
    pub fn set_connected(
        &mut self,
        id: &str,
        provider_name: &str,
        connection: Arc<ActiveConnection>,
    ) {
        if let Some(entry) = self.entries.get_mut(id) {
            entry.status = ConnectionStatus::Connected;
            entry.provider_name = Some(provider_name.to_string());
        }
        self.connections.insert(id.to_string(), connection);
    }

    pub fn set_disconnected(&mut self, id: &str) {
        if let Some(entry) = self.entries.get_mut(id) {
            entry.status = ConnectionStatus::Disconnected;
        }
        self.connections.remove(id);
    }

    #[allow(dead_code)]
    pub fn set_error(&mut self, id: &str) {
        if let Some(entry) = self.entries.get_mut(id) {
            entry.status = ConnectionStatus::Error;
        }
        self.connections.remove(id);
    }

    /// Add providers from discovery scan results.
    pub fn ingest_discovered(&mut self, descriptors: Vec<Value>) {
        for desc in descriptors {
            let id = desc["id"].as_str().unwrap_or("").to_string();
            if id.is_empty() || self.entries.contains_key(&id) {
                continue;
            }

            let name = desc["name"].as_str().unwrap_or(&id).to_string();
            let transport = match desc["transport"]["type"].as_str() {
                Some("unix") => {
                    if let Some(path) = desc["transport"]["path"].as_str() {
                        TransportConfig::Unix {
                            path: path.to_string(),
                        }
                    } else {
                        continue;
                    }
                }
                Some("ws") => {
                    if let Some(url) = desc["transport"]["url"].as_str() {
                        TransportConfig::Ws {
                            url: url.to_string(),
                        }
                    } else {
                        continue;
                    }
                }
                _ => continue,
            };

            self.entries.insert(
                id.clone(),
                ProviderEntry {
                    id,
                    name,
                    transport,
                    source: ProviderSource::Discovered,
                    status: ConnectionStatus::Disconnected,
                    provider_name: None,
                    bridge_tab_id: None,
                },
            );
        }
    }

    /// Add a provider announced from the browser extension bridge.
    pub fn ingest_bridge_provider(&mut self, tab_id: u64, provider_key: &str, provider: &Value) {
        if self.entries.contains_key(provider_key) {
            return;
        }

        let name = provider["name"]
            .as_str()
            .unwrap_or("Browser Tab")
            .to_string();

        let transport = match provider["transport"].as_str() {
            Some("ws") => {
                if let Some(url) = provider["url"].as_str() {
                    TransportConfig::Ws {
                        url: url.to_string(),
                    }
                } else {
                    return;
                }
            }
            Some("postmessage") | None => TransportConfig::Relay {
                provider_key: provider_key.to_string(),
            },
            _ => return,
        };

        self.entries.insert(
            provider_key.to_string(),
            ProviderEntry {
                id: provider_key.to_string(),
                name,
                transport,
                source: ProviderSource::Bridge,
                status: ConnectionStatus::Disconnected,
                provider_name: None,
                bridge_tab_id: Some(tab_id),
            },
        );
    }
}

// -- Bridge relay transport (from current provider_manager.rs) --

pub struct BridgeRelayTransport {
    app: AppHandle,
    provider_key: String,
}

impl BridgeRelayTransport {
    pub fn new(app: AppHandle, provider_key: String) -> Self {
        Self { app, provider_key }
    }
}

impl ClientTransport for BridgeRelayTransport {
    fn connect(
        &self,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = slop_ai::Result<(
                        mpsc::UnboundedSender<Value>,
                        mpsc::UnboundedReceiver<Value>,
                    )>,
                > + Send,
        >,
    > {
        let app = self.app.clone();
        let provider_key = self.provider_key.clone();

        Box::pin(async move {
            bridge::bridge_send_value(
                app.clone(),
                json!({
                    "type": "relay-open",
                    "providerKey": provider_key,
                }),
            )
            .await
            .map_err(SlopError::Transport)?;

            let mut relay_rx = bridge::subscribe_relay(app.clone(), &provider_key)
                .await
                .map_err(SlopError::Transport)?;

            bridge::bridge_send_value(
                app.clone(),
                json!({
                    "type": "slop-relay",
                    "providerKey": provider_key,
                    "message": { "type": "connect" },
                }),
            )
            .await
            .map_err(SlopError::Transport)?;

            let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<Value>();
            let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<Value>();

            let send_app = app.clone();
            let send_key = provider_key.clone();
            tokio::spawn(async move {
                while let Some(msg) = outgoing_rx.recv().await {
                    let _ = bridge::bridge_send_value(
                        send_app.clone(),
                        json!({
                            "type": "slop-relay",
                            "providerKey": send_key,
                            "message": msg,
                        }),
                    )
                    .await;
                }
                let _ = bridge::bridge_send_value(
                    send_app.clone(),
                    json!({
                        "type": "relay-close",
                        "providerKey": send_key,
                    }),
                )
                .await;
            });

            tokio::spawn(async move {
                while let Some(msg) = relay_rx.recv().await {
                    if incoming_tx.send(msg).is_err() {
                        break;
                    }
                }
            });

            Ok((outgoing_tx, incoming_rx))
        })
    }
}

/// Connect to a provider and set up callbacks.
pub async fn connect_provider(
    app: &AppHandle,
    registry: &Arc<Mutex<ProviderRegistry>>,
    provider_id: &str,
) -> Result<ProviderConnectResult, String> {
    // Disconnect if already connected
    {
        let mut reg = registry.lock().await;
        if reg.connections.contains_key(provider_id) {
            if let Some(conn) = reg.connections.remove(provider_id) {
                conn.consumer.disconnect().await;
            }
        }
    }

    let transport_config = {
        let reg = registry.lock().await;
        let entry = reg
            .get_entry(provider_id)
            .ok_or_else(|| format!("Provider {} not found", provider_id))?;
        entry.transport.clone()
    };

    let consumer = Arc::new(SlopConsumer::new());

    // Timeout to prevent hanging on dead sockets
    let connect_future = async {
        let hello = match &transport_config {
            TransportConfig::Ws { url } => {
                let t = WsClientTransport::new(url);
                consumer.connect(&t).await
            }
            TransportConfig::Unix { path } => {
                let t = UnixClientTransport::new(path);
                consumer.connect(&t).await
            }
            TransportConfig::Relay { provider_key } => {
                let t = BridgeRelayTransport::new(app.clone(), provider_key.clone());
                consumer.connect(&t).await
            }
        }
        .map_err(|err| err.to_string())?;

        let provider_name = hello["provider"]["name"]
            .as_str()
            .unwrap_or("Provider")
            .to_string();

        let (subscription_id, tree) = consumer
            .subscribe("/", -1)
            .await
            .map_err(|err| err.to_string())?;

        Ok::<_, String>((provider_name, subscription_id, tree))
    };

    let (provider_name, subscription_id, tree) =
        tokio::time::timeout(std::time::Duration::from_secs(10), connect_future)
            .await
            .map_err(|_| format!("Connection to provider {} timed out", provider_id))?
            ?;

    let connection = Arc::new(ActiveConnection::new(
        consumer.clone(),
        subscription_id.clone(),
        tree.clone(),
    ));

    // Register on_patch: update the tree in the connection
    let tree_ref = connection.current_tree.clone();
    let patch_app = app.clone();
    let patch_id = provider_id.to_string();
    let patch_name = provider_name.clone();
    let patch_consumer = consumer.clone();
    let patch_sub_id = subscription_id.clone();
    consumer
        .on_patch(move |_sub_id, _ops, _version| {
            let tree_ref = tree_ref.clone();
            let app = patch_app.clone();
            let id = patch_id.clone();
            let name = patch_name.clone();
            let consumer = patch_consumer.clone();
            let sub_id = patch_sub_id.clone();

            tokio::spawn(async move {
                if let Some(new_tree) = consumer.tree(&sub_id).await {
                    *tree_ref.lock().await = new_tree.clone();
                    events::emit_provider_status(
                        &app,
                        ProviderStatusPayload {
                            provider_id: id,
                            status: "connected".to_string(),
                            provider_name: Some(name),
                            tree: Some(new_tree),
                            message: None,
                        },
                    );
                }
            });
        })
        .await;

    // Register on_disconnect
    let disconnect_app = app.clone();
    let disconnect_id = provider_id.to_string();
    let disconnect_registry = registry.clone();
    consumer
        .on_disconnect(move || {
            let app = disconnect_app.clone();
            let id = disconnect_id.clone();
            let reg = disconnect_registry.clone();

            tokio::spawn(async move {
                reg.lock().await.set_disconnected(&id);
                events::emit_provider_status(
                    &app,
                    ProviderStatusPayload {
                        provider_id: id,
                        status: "disconnected".to_string(),
                        provider_name: None,
                        tree: None,
                        message: None,
                    },
                );
            });
        })
        .await;

    // Register on_error
    let error_app = app.clone();
    let error_id = provider_id.to_string();
    consumer
        .on_error(move |_msg_id, code, message| {
            events::emit_provider_status(
                &error_app,
                ProviderStatusPayload {
                    provider_id: error_id.clone(),
                    status: "error".to_string(),
                    provider_name: None,
                    tree: None,
                    message: Some(format!("{}: {}", code, message)),
                },
            );
        })
        .await;

    // Store the connection
    {
        let mut reg = registry.lock().await;
        reg.set_connected(provider_id, &provider_name, connection);
    }

    Ok(ProviderConnectResult {
        provider_name,
        tree,
    })
}

/// Disconnect a provider.
pub async fn disconnect_provider(registry: &Arc<Mutex<ProviderRegistry>>, provider_id: &str) {
    let mut reg = registry.lock().await;
    if let Some(conn) = reg.connections.remove(provider_id) {
        conn.consumer.disconnect().await;
    }
    reg.set_disconnected(provider_id);
}
