mod bridge;
mod relay_transport;
mod service;
mod tools;
mod types;

pub use bridge::{
    Bridge, BridgeClient, BridgeProvider, BridgeServer, ProviderChangeCallback, RelaySubscription,
    DEFAULT_BRIDGE_ADDR, DEFAULT_BRIDGE_PATH, DEFAULT_BRIDGE_URL,
};
pub use relay_transport::BridgeRelayTransport;
pub use service::DiscoveryService;
pub use tools::{
    create_dynamic_tools, create_tool_handlers, DynamicToolEntry, DynamicToolResolution,
    DynamicToolSet, ToolContent, ToolHandlers, ToolResult,
};
pub use types::{
    ConnectedProvider, DiscoveryServiceOptions, ProviderDescriptor, ProviderSource,
    ProviderStatus, TransportDescriptor,
};

#[cfg(test)]
mod tests;
