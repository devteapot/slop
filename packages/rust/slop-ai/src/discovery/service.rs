use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

use crate::consumer::{ClientTransport, SlopConsumer};
use crate::error::{Result, SlopError};
use crate::transport::unix_client::UnixClientTransport;
use crate::transport::ws_client::WsClientTransport;
use crate::types::PatchOp;

use super::bridge::{Bridge, BridgeClient, BridgeServer, ProviderChangeCallback};
use super::relay_transport::BridgeRelayTransport;
use super::types::{
    ConnectedProvider, DiscoveryServiceOptions, ProviderDescriptor, ProviderSource, ProviderStatus,
};

#[derive(Clone)]
pub struct DiscoveryService {
    inner: Arc<Mutex<DiscoveryInner>>,
}

struct DiscoveryInner {
    options: DiscoveryServiceOptions,
    providers: HashMap<String, ConnectedProvider>,
    local_descriptors: Vec<ProviderDescriptor>,
    last_accessed: HashMap<String, Instant>,
    reconnect_attempts: HashMap<String, u32>,
    intentional_disconnects: HashSet<String>,
    bridge: Option<Arc<dyn Bridge>>,
    callbacks: Vec<ProviderChangeCallback>,
    started: bool,
    dir_snapshots: HashMap<PathBuf, Vec<String>>,
    scan_task: Option<JoinHandle<()>>,
    watch_task: Option<JoinHandle<()>>,
    idle_task: Option<JoinHandle<()>>,
    bridge_task: Option<JoinHandle<()>>,
    reconnect_tasks: HashMap<String, JoinHandle<()>>,
}

impl DiscoveryService {
    pub fn new(options: DiscoveryServiceOptions) -> Self {
        Self {
            inner: Arc::new(Mutex::new(DiscoveryInner {
                options,
                providers: HashMap::new(),
                local_descriptors: Vec::new(),
                last_accessed: HashMap::new(),
                reconnect_attempts: HashMap::new(),
                intentional_disconnects: HashSet::new(),
                bridge: None,
                callbacks: Vec::new(),
                started: false,
                dir_snapshots: HashMap::new(),
                scan_task: None,
                watch_task: None,
                idle_task: None,
                bridge_task: None,
                reconnect_tasks: HashMap::new(),
            })),
        }
    }

    pub async fn start(&self) {
        let mut inner = self.inner.lock().await;
        if inner.started {
            return;
        }
        inner.started = true;
        let options = inner.options.clone();
        drop(inner);

        self.scan().await;

        let scan_service = self.clone();
        let scan_interval = options.scan_interval;
        let scan_task = tokio::spawn(async move {
            loop {
                sleep(scan_interval).await;
                if !scan_service.is_started().await {
                    break;
                }
                scan_service.scan().await;
            }
        });

        let watch_service = self.clone();
        let watch_interval = options.watch_interval;
        let watch_task = tokio::spawn(async move {
            loop {
                sleep(watch_interval).await;
                if !watch_service.is_started().await {
                    break;
                }
                watch_service.check_directory_changes().await;
            }
        });

        let idle_service = self.clone();
        let idle_timeout_check = Duration::from_secs(60);
        let idle_task = tokio::spawn(async move {
            loop {
                sleep(idle_timeout_check).await;
                if !idle_service.is_started().await {
                    break;
                }
                idle_service.check_idle().await;
            }
        });

        let bridge_service = self.clone();
        let bridge_task = tokio::spawn(async move {
            bridge_service.init_bridge().await;
        });

        let mut inner = self.inner.lock().await;
        inner.scan_task = Some(scan_task);
        inner.watch_task = Some(watch_task);
        inner.idle_task = Some(idle_task);
        inner.bridge_task = Some(bridge_task);
    }

    pub async fn stop(&self) {
        let (tasks, reconnect_tasks, bridge, providers) = {
            let mut inner = self.inner.lock().await;
            if !inner.started {
                return;
            }
            inner.started = false;
            let tasks = vec![
                inner.scan_task.take(),
                inner.watch_task.take(),
                inner.idle_task.take(),
                inner.bridge_task.take(),
            ];
            let reconnect_tasks = inner.reconnect_tasks.drain().map(|(_, task)| task).collect::<Vec<_>>();
            let bridge = inner.bridge.take();
            let providers = inner.providers.drain().map(|(_, provider)| provider).collect::<Vec<_>>();
            inner.local_descriptors.clear();
            inner.last_accessed.clear();
            inner.reconnect_attempts.clear();
            inner.intentional_disconnects.clear();
            inner.dir_snapshots.clear();
            (tasks, reconnect_tasks, bridge, providers)
        };

        for task in tasks.into_iter().flatten() {
            task.abort();
        }
        for task in reconnect_tasks {
            task.abort();
        }
        if let Some(bridge) = bridge {
            bridge.stop().await;
        }
        for provider in providers {
            provider.consumer.disconnect().await;
        }
    }

    pub async fn on_state_change<F>(&self, callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        self.inner.lock().await.callbacks.push(Arc::new(callback));
    }

    pub async fn get_discovered(&self) -> Vec<ProviderDescriptor> {
        let (local, bridge) = {
            let inner = self.inner.lock().await;
            (inner.local_descriptors.clone(), inner.bridge.clone())
        };

        let mut descriptors = local;
        if let Some(bridge) = bridge {
            if bridge.running() {
                descriptors.extend(bridge.providers().into_iter().map(|provider| provider.to_descriptor()));
            }
        }
        descriptors
    }

    pub async fn get_providers(&self) -> Vec<ConnectedProvider> {
        self.inner
            .lock()
            .await
            .providers
            .values()
            .filter(|provider| provider.status == ProviderStatus::Connected)
            .cloned()
            .collect()
    }

    pub async fn get_provider(&self, id: &str) -> Option<ConnectedProvider> {
        let mut inner = self.inner.lock().await;
        let provider = inner.providers.get(id).cloned();
        if provider.as_ref().is_some_and(|provider| provider.status == ProviderStatus::Connected) {
            inner.last_accessed.insert(id.to_string(), Instant::now());
        }
        provider.filter(|provider| provider.status == ProviderStatus::Connected)
    }

    pub async fn ensure_connected(&self, id_or_name: &str) -> Result<Option<ConnectedProvider>> {
        if let Some(provider) = self.find_connected_provider(id_or_name).await {
            return Ok(Some(provider));
        }

        let descriptor = self.find_descriptor(id_or_name).await;
        match descriptor {
            Some(descriptor) => self.connect_provider(descriptor).await,
            None => Ok(None),
        }
    }

    pub async fn disconnect(&self, id_or_name: &str) -> bool {
        let provider = {
            let mut inner = self.inner.lock().await;
            let needle = id_or_name.to_lowercase();
            let provider_id = inner
                .providers
                .iter()
                .find(|(id, provider)| {
                    *id == id_or_name || provider.name.to_lowercase().contains(&needle)
                })
                .map(|(id, _)| id.clone());

            let Some(provider_id) = provider_id else {
                return false;
            };

            inner.intentional_disconnects.insert(provider_id.clone());
            inner.last_accessed.remove(&provider_id);
            inner.reconnect_attempts.remove(&provider_id);
            if let Some(task) = inner.reconnect_tasks.remove(&provider_id) {
                task.abort();
            }
            inner.providers.remove(&provider_id)
        };

        if let Some(provider) = provider {
            provider.consumer.disconnect().await;
            self.fire_state_change().await;
            true
        } else {
            false
        }
    }

    async fn is_started(&self) -> bool {
        self.inner.lock().await.started
    }

    async fn init_bridge(&self) {
        let options = self.inner.lock().await.options.clone();

        let client = Arc::new(BridgeClient::new(
            &options.bridge_url,
            options.bridge_retry_delay,
            options.bridge_dial_timeout,
        ));

        if client.connect_once().await.is_ok() {
            client.start();
            self.attach_bridge(client as Arc<dyn Bridge>).await;
            return;
        }

        if !options.host_bridge {
            client.start();
            self.attach_bridge(client as Arc<dyn Bridge>).await;
            return;
        }

        let server = Arc::new(BridgeServer::new(&options.bridge_addr, &options.bridge_path));
        if server.start().await.is_ok() {
            self.attach_bridge(server as Arc<dyn Bridge>).await;
            return;
        }

        client.start();
        self.attach_bridge(client as Arc<dyn Bridge>).await;
    }

    async fn attach_bridge(&self, bridge: Arc<dyn Bridge>) {
        {
            let mut inner = self.inner.lock().await;
            if !inner.started {
                drop(inner);
                bridge.stop().await;
                return;
            }
            inner.bridge = Some(bridge.clone());
        }

        let service = self.clone();
        bridge.on_provider_change(Arc::new(move || {
            let service = service.clone();
            tokio::spawn(async move {
                service.scan().await;
            });
        }));

        self.scan().await;
    }

    async fn scan(&self) {
        let descriptors = self.read_descriptors().await;
        let bridge = self.inner.lock().await.bridge.clone();
        let bridge_descriptors = bridge
            .as_ref()
            .filter(|bridge| bridge.running())
            .map(|bridge| bridge.providers().into_iter().map(|provider| provider.to_descriptor()).collect::<Vec<_>>())
            .unwrap_or_default();
        let all_descriptors = descriptors
            .iter()
            .cloned()
            .chain(bridge_descriptors.iter().cloned())
            .collect::<Vec<_>>();
        let all_ids = all_descriptors.iter().map(|descriptor| descriptor.id.clone()).collect::<HashSet<_>>();

        let (removed_providers, callbacks, auto_connect, started) = {
            let mut inner = self.inner.lock().await;
            inner.local_descriptors = descriptors;

            let removed_ids = inner
                .providers
                .keys()
                .filter(|id| !all_ids.contains(*id))
                .cloned()
                .collect::<Vec<_>>();

            let mut removed = Vec::new();
            for id in removed_ids {
                inner.intentional_disconnects.insert(id.clone());
                inner.last_accessed.remove(&id);
                inner.reconnect_attempts.remove(&id);
                if let Some(task) = inner.reconnect_tasks.remove(&id) {
                    task.abort();
                }
                if let Some(provider) = inner.providers.remove(&id) {
                    removed.push(provider);
                }
            }

            (
                removed,
                inner.callbacks.clone(),
                inner.options.auto_connect,
                inner.started,
            )
        };

        for provider in removed_providers {
            provider.consumer.disconnect().await;
        }
        if !callbacks.is_empty() {
            fire_callbacks(callbacks);
        }

        if !auto_connect || !started {
            return;
        }

        for descriptor in all_descriptors {
            let should_connect = {
                let inner = self.inner.lock().await;
                !inner.providers.contains_key(&descriptor.id)
            };
            if should_connect {
                let service = self.clone();
                tokio::spawn(async move {
                    let _ = service.connect_provider(descriptor).await;
                });
            }
        }
    }

    async fn check_directory_changes(&self) {
        let dirs = self.inner.lock().await.options.providers_dirs.clone();
        let mut changed = false;
        let mut signatures = HashMap::new();
        for dir in dirs {
            let signature = directory_signature(&dir);
            signatures.insert(dir.clone(), signature);
        }

        {
            let mut inner = self.inner.lock().await;
            for (dir, signature) in signatures {
                let prior = inner.dir_snapshots.get(&dir);
                if prior != Some(&signature) {
                    inner.dir_snapshots.insert(dir, signature);
                    changed = true;
                }
            }
        }

        if changed {
            self.scan().await;
        }
    }

    async fn check_idle(&self) {
        let (idle_timeout, providers) = {
            let inner = self.inner.lock().await;
            let now = Instant::now();
            let idle_timeout = inner.options.idle_timeout;
            let providers = inner
                .last_accessed
                .iter()
                .filter(|(_, accessed)| now.duration_since(**accessed) > idle_timeout)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            (idle_timeout, providers)
        };
        let _ = idle_timeout;

        for provider_id in providers {
            let provider = {
                let mut inner = self.inner.lock().await;
                inner.intentional_disconnects.insert(provider_id.clone());
                inner.last_accessed.remove(&provider_id);
                inner.reconnect_attempts.remove(&provider_id);
                inner.providers.remove(&provider_id)
            };

            if let Some(provider) = provider {
                provider.consumer.disconnect().await;
                self.fire_state_change().await;
            }
        }
    }

    async fn connect_provider(&self, descriptor: ProviderDescriptor) -> Result<Option<ConnectedProvider>> {
        loop {
            let mut inner = self.inner.lock().await;
            if let Some(existing) = inner.providers.get(&descriptor.id).cloned() {
                match existing.status {
                    ProviderStatus::Connected => {
                        inner.last_accessed.insert(descriptor.id.clone(), Instant::now());
                        return Ok(Some(existing));
                    }
                    ProviderStatus::Connecting => {
                        drop(inner);
                        sleep(Duration::from_millis(10)).await;
                        continue;
                    }
                    ProviderStatus::Disconnected => {}
                }
            }

            let provider = ConnectedProvider {
                id: descriptor.id.clone(),
                name: descriptor.name.clone(),
                descriptor: descriptor.clone(),
                consumer: Arc::new(SlopConsumer::new()),
                subscription_id: String::new(),
                status: ProviderStatus::Connecting,
            };
            let consumer = Arc::clone(&provider.consumer);
            let bridge = inner.bridge.clone();
            let timeout_duration = inner.options.connect_timeout;
            inner.providers.insert(descriptor.id.clone(), provider);
            drop(inner);

            let Some(transport) = create_transport(&descriptor, bridge) else {
                self.inner.lock().await.providers.remove(&descriptor.id);
                return Ok(None);
            };

            let hello = timeout(timeout_duration, consumer.connect(transport.as_ref()))
                .await
                .map_err(|_| SlopError::Transport("connection timed out after 10s".to_string()))??;

            let (subscription_id, _tree) = timeout(timeout_duration, consumer.subscribe("/", -1))
                .await
                .map_err(|_| SlopError::Transport("subscription timed out after 10s".to_string()))??;

            let provider_name = hello["provider"]["name"]
                .as_str()
                .unwrap_or(&descriptor.name)
                .to_string();

            let service = self.clone();
            consumer
                .on_patch(move |_, _: &[PatchOp], _| {
                    let service = service.clone();
                    tokio::spawn(async move {
                        service.fire_state_change().await;
                    });
                })
                .await;

            let service = self.clone();
            let disconnect_desc = descriptor.clone();
            let disconnect_name = provider_name.clone();
            consumer
                .on_disconnect(move || {
                    service.spawn_handle_disconnect(disconnect_desc.clone(), disconnect_name.clone());
                })
                .await;

            let connected_provider = {
                let mut inner = self.inner.lock().await;
                let provider = ConnectedProvider {
                    id: descriptor.id.clone(),
                    name: provider_name,
                    descriptor: descriptor.clone(),
                    consumer,
                    subscription_id,
                    status: ProviderStatus::Connected,
                };
                inner.last_accessed.insert(descriptor.id.clone(), Instant::now());
                inner.reconnect_attempts.remove(&descriptor.id);
                inner.intentional_disconnects.remove(&descriptor.id);
                inner.providers.insert(descriptor.id.clone(), provider.clone());
                provider
            };

            self.fire_state_change().await;
            return Ok(Some(connected_provider));
        }
    }

    async fn handle_provider_disconnect(&self, descriptor: ProviderDescriptor, name: String) {
        let (intentional, callbacks, started, attempt, delay) = {
            let mut inner = self.inner.lock().await;
            inner.providers.remove(&descriptor.id);
            inner.last_accessed.remove(&descriptor.id);
            let intentional = inner.intentional_disconnects.remove(&descriptor.id);
            let callbacks = inner.callbacks.clone();
            if intentional || !inner.started {
                (intentional, callbacks, inner.started, 0, Duration::from_secs(0))
            } else {
                let attempt = inner.reconnect_attempts.get(&descriptor.id).copied().unwrap_or(0) + 1;
                inner.reconnect_attempts.insert(descriptor.id.clone(), attempt);
                let multiplier = 1u32.checked_shl(attempt - 1).unwrap_or(u32::MAX);
                let delay = inner
                    .options
                    .reconnect_base_delay
                    .checked_mul(multiplier)
                    .unwrap_or(inner.options.max_reconnect_delay)
                    .min(inner.options.max_reconnect_delay);
                (intentional, callbacks, inner.started, attempt, delay)
            }
        };

        fire_callbacks(callbacks);

        if intentional || !started || self.find_descriptor(&descriptor.id).await.is_none() {
            return;
        }

        let service = self.clone();
        let descriptor_id = descriptor.id.clone();
        let reconnect_key = descriptor_id.clone();
        let task = tokio::spawn(reconnect_provider_after_delay(
            service,
            descriptor,
            descriptor_id,
            delay,
        ));

        let mut inner = self.inner.lock().await;
        if let Some(old_task) = inner.reconnect_tasks.insert(reconnect_key.clone(), task) {
            old_task.abort();
        }
        let _ = name;
        let _ = attempt;
    }

    async fn find_connected_provider(&self, id_or_name: &str) -> Option<ConnectedProvider> {
        let mut inner = self.inner.lock().await;
        if let Some(provider) = inner.providers.get(id_or_name).cloned() {
            if provider.status == ProviderStatus::Connected {
                inner.last_accessed.insert(provider.id.clone(), Instant::now());
                return Some(provider);
            }
        }

        let needle = id_or_name.to_lowercase();
        let provider = inner
            .providers
            .values()
            .find(|provider| {
                provider.status == ProviderStatus::Connected
                    && provider.name.to_lowercase().contains(&needle)
            })
            .cloned();
        if let Some(provider) = provider.clone() {
            inner.last_accessed.insert(provider.id.clone(), Instant::now());
        }
        provider
    }

    async fn find_descriptor(&self, id_or_name: &str) -> Option<ProviderDescriptor> {
        let needle = id_or_name.to_lowercase();
        self.get_discovered()
            .await
            .into_iter()
            .find(|descriptor| descriptor.id == id_or_name || descriptor.name.to_lowercase().contains(&needle))
    }

    async fn read_descriptors(&self) -> Vec<ProviderDescriptor> {
        let dirs = self.inner.lock().await.options.providers_dirs.clone();
        let mut descriptors = Vec::new();
        for dir in dirs {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }

                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let Ok(mut descriptor) = serde_json::from_str::<ProviderDescriptor>(&content) else {
                    continue;
                };
                if !is_valid_descriptor(&descriptor) {
                    continue;
                }
                descriptor.source = ProviderSource::Local;
                descriptors.push(descriptor);
            }
        }
        descriptors
    }

    async fn fire_state_change(&self) {
        let callbacks = self.inner.lock().await.callbacks.clone();
        fire_callbacks(callbacks);
    }

    fn spawn_handle_disconnect(&self, descriptor: ProviderDescriptor, name: String) {
        let service = self.clone();
        tokio::spawn(async move {
            service.handle_provider_disconnect(descriptor, name).await;
        });
    }
}

async fn reconnect_provider_after_delay(
    service: DiscoveryService,
    descriptor: ProviderDescriptor,
    descriptor_id: String,
    delay: Duration,
) {
    sleep(delay).await;
    if service.is_started().await && service.find_descriptor(&descriptor_id).await.is_some() {
        let _ = service.connect_provider(descriptor).await;
    }
}

fn create_transport(
    descriptor: &ProviderDescriptor,
    bridge: Option<Arc<dyn Bridge>>,
) -> Option<Box<dyn ClientTransport + Send + Sync>> {
    match descriptor.transport.transport_type.as_str() {
        "unix" => descriptor
            .transport
            .path
            .as_ref()
            .map(|path| Box::new(UnixClientTransport::new(path)) as Box<dyn ClientTransport + Send + Sync>),
        "ws" => descriptor
            .transport
            .url
            .as_ref()
            .map(|url| Box::new(WsClientTransport::new(url)) as Box<dyn ClientTransport + Send + Sync>),
        "relay" => descriptor.provider_key.as_ref().and_then(|provider_key| {
            bridge.map(|bridge| {
                Box::new(BridgeRelayTransport::new(bridge, provider_key.clone()))
                    as Box<dyn ClientTransport + Send + Sync>
            })
        }),
        _ => None,
    }
}

fn is_valid_descriptor(descriptor: &ProviderDescriptor) -> bool {
    !descriptor.id.is_empty()
        && !descriptor.name.is_empty()
        && matches!(descriptor.transport.transport_type.as_str(), "unix" | "ws" | "stdio" | "relay")
}

fn directory_signature(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut signature = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            signature.push(format!(
                "{}:{}:{}",
                path.file_name().and_then(|name| name.to_str()).unwrap_or_default(),
                modified,
                metadata.len()
            ));
        }
    }
    signature.sort();
    signature
}

fn fire_callbacks(callbacks: Vec<ProviderChangeCallback>) {
    for callback in callbacks {
        callback();
    }
}
