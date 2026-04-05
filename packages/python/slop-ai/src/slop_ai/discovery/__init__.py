"""Core discovery layer for the Python SDK."""

from .bridge import Bridge, BridgeClient, BridgeServer, RelayHandler
from .models import (
    BridgeProvider,
    ConnectedProvider,
    DiscoveryOptions,
    DynamicToolEntry,
    DynamicToolResolution,
    DynamicToolSet,
    ProviderDescriptor,
    ToolResult,
)
from .relay_transport import BridgeRelayTransport
from .service import DiscoveryService, create_discovery_service
from .tools import ToolHandlers, create_dynamic_tools, create_tool_handlers

__all__ = [
    "Bridge",
    "BridgeClient",
    "BridgeProvider",
    "BridgeRelayTransport",
    "BridgeServer",
    "ConnectedProvider",
    "DiscoveryOptions",
    "DiscoveryService",
    "DynamicToolEntry",
    "DynamicToolResolution",
    "DynamicToolSet",
    "RelayHandler",
    "ProviderDescriptor",
    "ToolHandlers",
    "ToolResult",
    "create_discovery_service",
    "create_dynamic_tools",
    "create_tool_handlers",
]
