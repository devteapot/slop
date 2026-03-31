use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use slop_ai::{ClientTransport, SlopConsumer, SlopError, SlopNode, UnixClientTransport, WsClientTransport};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

use crate::bridge::{bridge_send_value, subscribe_relay};

pub struct ProviderConnection {
    consumer: Arc<SlopConsumer>,
}

pub struct ProviderStore(pub Mutex<HashMap<String, ProviderConnection>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ProviderTransportConfig {
    #[serde(rename = "ws")]
    Ws { url: String },
    #[serde(rename = "unix")]
    Unix { path: String },
    #[serde(rename = "relay")]
    Relay { provider_key: String },
}

#[derive(Debug, Serialize)]
pub struct ProviderConnectResult {
    #[serde(rename = "providerName")]
    provider_name: String,
    tree: SlopNode,
}

#[derive(Debug, Serialize)]
pub struct ProviderInvokeError {
    code: String,
    message: String,
}

#[derive(Debug, Serialize)]
pub struct ProviderInvokeResult {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ProviderInvokeError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderEvent {
    #[serde(rename = "providerId")]
    provider_id: String,
    kind: String,
    #[serde(rename = "providerName", skip_serializing_if = "Option::is_none")]
    provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tree: Option<SlopNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn emit_provider_event(app: &AppHandle, event: ProviderEvent) {
    let _ = app.emit("provider-event", event);
}

struct BridgeRelayTransport {
    app: AppHandle,
    provider_key: String,
}

impl BridgeRelayTransport {
    fn new(app: AppHandle, provider_key: String) -> Self {
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
            bridge_send_value(
                app.clone(),
                json!({
                    "type": "relay-open",
                    "providerKey": provider_key,
                }),
            )
            .await
            .map_err(SlopError::Transport)?;

            let mut relay_rx = subscribe_relay(app.clone(), &provider_key)
                .await
                .map_err(SlopError::Transport)?;

            bridge_send_value(
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
                    let _ = bridge_send_value(
                        send_app.clone(),
                        json!({
                            "type": "slop-relay",
                            "providerKey": send_key,
                            "message": msg,
                        }),
                    )
                    .await;
                }

                let _ = bridge_send_value(
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

async fn disconnect_internal(app: &AppHandle, provider_id: &str) {
    let store = app.state::<ProviderStore>();
    let mut connections = store.0.lock().await;
    if let Some(conn) = connections.remove(provider_id) {
        conn.consumer.disconnect().await;
    }
}

#[tauri::command]
pub async fn provider_connect(
    app: AppHandle,
    provider_id: String,
    transport: ProviderTransportConfig,
) -> Result<ProviderConnectResult, String> {
    disconnect_internal(&app, &provider_id).await;

    let consumer = Arc::new(SlopConsumer::new());

    let hello = match transport.clone() {
        ProviderTransportConfig::Ws { url } => {
            let ws_transport = WsClientTransport::new(&url);
            consumer.connect(&ws_transport).await
        }
        ProviderTransportConfig::Unix { path } => {
            let unix_transport = UnixClientTransport::new(&path);
            consumer.connect(&unix_transport).await
        }
        ProviderTransportConfig::Relay { provider_key } => {
            let relay_transport = BridgeRelayTransport::new(app.clone(), provider_key);
            consumer.connect(&relay_transport).await
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

    let patch_consumer = consumer.clone();
    let patch_app = app.clone();
    let patch_provider_id = provider_id.clone();
    let patch_provider_name = provider_name.clone();
    let patch_subscription_id = subscription_id.clone();
    consumer
        .on_patch(move |_sub_id, _ops, _version| {
            let app = patch_app.clone();
            let provider_id = patch_provider_id.clone();
            let provider_name = patch_provider_name.clone();
            let subscription_id = patch_subscription_id.clone();
            let consumer = patch_consumer.clone();

            tokio::spawn(async move {
                if let Some(tree) = consumer.tree(&subscription_id).await {
                    emit_provider_event(
                        &app,
                        ProviderEvent {
                            provider_id,
                            kind: "tree".into(),
                            provider_name: Some(provider_name),
                            tree: Some(tree),
                            message: None,
                        },
                    );
                }
            });
        })
        .await;

    let disconnect_app = app.clone();
    let disconnect_provider_id = provider_id.clone();
    consumer
        .on_disconnect(move || {
            let app = disconnect_app.clone();
            let provider_id = disconnect_provider_id.clone();

            tokio::spawn(async move {
                let store = app.state::<ProviderStore>();
                store.0.lock().await.remove(&provider_id);
                emit_provider_event(
                    &app,
                    ProviderEvent {
                        provider_id,
                        kind: "disconnected".into(),
                        provider_name: None,
                        tree: None,
                        message: None,
                    },
                );
            });
        })
        .await;

    let error_app = app.clone();
    let error_provider_id = provider_id.clone();
    consumer
        .on_error(move |_id, code, message| {
            emit_provider_event(
                &error_app,
                ProviderEvent {
                    provider_id: error_provider_id.clone(),
                    kind: "error".into(),
                    provider_name: None,
                    tree: None,
                    message: Some(format!("{code}: {message}")),
                },
            );
        })
        .await;

    let store = app.state::<ProviderStore>();
    store.0.lock().await.insert(
        provider_id,
        ProviderConnection {
            consumer,
        },
    );

    Ok(ProviderConnectResult { provider_name, tree })
}

#[tauri::command]
pub async fn provider_disconnect(app: AppHandle, provider_id: String) -> Result<(), String> {
    disconnect_internal(&app, &provider_id).await;
    Ok(())
}

#[tauri::command]
pub async fn provider_invoke(
    app: AppHandle,
    provider_id: String,
    path: String,
    action: String,
    params: Option<Value>,
) -> Result<ProviderInvokeResult, String> {
    let store = app.state::<ProviderStore>();
    let connections = store.0.lock().await;
    let conn = connections
        .get(&provider_id)
        .ok_or_else(|| format!("Provider {provider_id} is not connected"))?;
    let consumer = conn.consumer.clone();
    drop(connections);

    match consumer.invoke(&path, &action, params).await {
        Ok(value) => Ok(ProviderInvokeResult {
            status: value["status"].as_str().unwrap_or("ok").to_string(),
            data: value.get("data").cloned(),
            error: value.get("error").map(|error| ProviderInvokeError {
                code: error["code"].as_str().unwrap_or("unknown").to_string(),
                message: error["message"].as_str().unwrap_or("Unknown error").to_string(),
            }),
        }),
        Err(SlopError::ActionFailed { code, message }) => Ok(ProviderInvokeResult {
            status: "error".into(),
            data: None,
            error: Some(ProviderInvokeError { code, message }),
        }),
        Err(err) => Err(err.to_string()),
    }
}
