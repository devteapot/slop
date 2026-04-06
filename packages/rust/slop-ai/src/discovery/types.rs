use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::consumer::SlopConsumer;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderSource {
    Local,
    Bridge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderStatus {
    Connecting,
    Connected,
    Disconnected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportDescriptor {
    #[serde(rename = "type")]
    pub transport_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    pub slop_version: String,
    pub transport: TransportDescriptor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub capabilities: Vec<String>,
    #[serde(skip)]
    pub provider_key: Option<String>,
    #[serde(skip, default = "default_provider_source")]
    pub source: ProviderSource,
}

impl ProviderDescriptor {
    pub fn address(&self) -> String {
        match self.transport.transport_type.as_str() {
            "unix" => self
                .transport
                .path
                .as_ref()
                .map(|path| format!("unix:{path}"))
                .unwrap_or_else(|| "unix".to_string()),
            "ws" => self
                .transport
                .url
                .clone()
                .unwrap_or_else(|| "ws".to_string()),
            "relay" => self
                .provider_key
                .as_ref()
                .map(|key| format!("bridge:{key}"))
                .unwrap_or_else(|| "relay".to_string()),
            other => other.to_string(),
        }
    }
}

#[derive(Clone)]
pub struct ConnectedProvider {
    pub id: String,
    pub name: String,
    pub descriptor: ProviderDescriptor,
    pub consumer: Arc<SlopConsumer>,
    pub subscription_id: String,
    pub status: ProviderStatus,
}

impl fmt::Debug for ConnectedProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ConnectedProvider")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("descriptor", &self.descriptor)
            .field("subscription_id", &self.subscription_id)
            .field("status", &self.status)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveryServiceOptions {
    pub auto_connect: bool,
    pub host_bridge: bool,
    pub providers_dirs: Vec<std::path::PathBuf>,
    pub bridge_url: String,
    pub bridge_addr: String,
    pub bridge_path: String,
    pub idle_timeout: Duration,
    pub connect_timeout: Duration,
    pub scan_interval: Duration,
    pub watch_interval: Duration,
    pub reconnect_base_delay: Duration,
    pub max_reconnect_delay: Duration,
    pub bridge_dial_timeout: Duration,
    pub bridge_retry_delay: Duration,
}

impl Default for DiscoveryServiceOptions {
    fn default() -> Self {
        let home = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir());

        Self {
            auto_connect: false,
            host_bridge: true,
            providers_dirs: vec![
                home.join(".slop").join("providers"),
                std::env::temp_dir().join("slop").join("providers"),
            ],
            bridge_url: super::bridge::DEFAULT_BRIDGE_URL.to_string(),
            bridge_addr: super::bridge::DEFAULT_BRIDGE_ADDR.to_string(),
            bridge_path: super::bridge::DEFAULT_BRIDGE_PATH.to_string(),
            idle_timeout: Duration::from_secs(5 * 60),
            connect_timeout: Duration::from_secs(10),
            scan_interval: Duration::from_secs(15),
            watch_interval: Duration::from_millis(500),
            reconnect_base_delay: Duration::from_secs(3),
            max_reconnect_delay: Duration::from_secs(30),
            bridge_dial_timeout: Duration::from_secs(1),
            bridge_retry_delay: Duration::from_secs(5),
        }
    }
}

fn default_provider_source() -> ProviderSource {
    ProviderSource::Local
}
