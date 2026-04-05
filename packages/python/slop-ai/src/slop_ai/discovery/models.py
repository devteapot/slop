"""Shared discovery-layer models for the Python SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from slop_ai.consumer import SlopConsumer

ProviderSource = Literal["local", "bridge"]
ProviderStatus = Literal["connecting", "connected", "disconnected"]


@dataclass(slots=True)
class TransportDescriptor:
    """How to connect to a provider."""

    type: Literal["unix", "ws", "stdio", "relay"]
    path: str | None = None
    url: str | None = None


@dataclass(slots=True)
class ProviderDescriptor:
    """Discoverable provider descriptor."""

    id: str
    name: str
    slop_version: str
    transport: TransportDescriptor
    capabilities: list[str]
    pid: int | None = None
    provider_key: str | None = None
    source: ProviderSource = "local"

    def address(self) -> str:
        if self.transport.type == "unix" and self.transport.path:
            return f"unix:{self.transport.path}"
        if self.transport.type == "ws" and self.transport.url:
            return self.transport.url
        if self.transport.type == "relay" and self.provider_key:
            return f"bridge:{self.provider_key}"
        return self.transport.type


@dataclass(slots=True)
class ConnectedProvider:
    """Active provider connection managed by the discovery service."""

    id: str
    name: str
    descriptor: ProviderDescriptor
    consumer: SlopConsumer
    subscription_id: str
    status: ProviderStatus


@dataclass(slots=True)
class BridgeProvider:
    """Provider announced through the extension bridge."""

    provider_key: str
    tab_id: int
    id: str
    name: str
    transport: Literal["ws", "postmessage"]
    url: str | None = None


@dataclass(slots=True)
class DiscoveryOptions:
    """Discovery service configuration."""

    logger: Any | None = None
    auto_connect: bool = False
    host_bridge: bool = True
    providers_dirs: list[str] | None = None
    bridge_url: str = "ws://127.0.0.1:9339/slop-bridge"
    idle_timeout: float = 5 * 60.0
    connect_timeout: float = 10.0
    scan_interval: float = 15.0
    watch_interval: float = 0.5
    reconnect_base_delay: float = 3.0
    max_reconnect_delay: float = 30.0
    bridge_dial_timeout: float = 1.0
    bridge_retry_delay: float = 5.0


@dataclass(slots=True)
class DynamicToolEntry:
    """Provider-scoped dynamic affordance tool."""

    name: str
    description: str
    input_schema: dict[str, Any]
    provider_id: str
    path: str
    action: str


@dataclass(slots=True)
class DynamicToolResolution:
    """Maps a dynamic tool name back to invoke coordinates."""

    provider_id: str
    path: str
    action: str


@dataclass(slots=True)
class DynamicToolSet:
    """Dynamic tool definitions and a resolver."""

    tools: list[DynamicToolEntry] = field(default_factory=list)
    _resolve_map: dict[str, DynamicToolResolution] = field(default_factory=dict)

    def resolve(self, tool_name: str) -> DynamicToolResolution | None:
        return self._resolve_map.get(tool_name)


@dataclass(slots=True)
class ToolResult:
    """Host-agnostic tool result payload."""

    content: list[dict[str, str]]
    is_error: bool = False


def descriptor_from_dict(
    data: dict[str, Any], *, source: ProviderSource = "local"
) -> ProviderDescriptor | None:
    """Parse and validate a provider descriptor dictionary."""
    provider_id = data.get("id")
    name = data.get("name")
    transport_data = data.get("transport")
    capabilities = data.get("capabilities")

    if not isinstance(provider_id, str) or not provider_id:
        return None
    if not isinstance(name, str) or not name:
        return None
    if not isinstance(transport_data, dict):
        return None
    transport_type = transport_data.get("type")
    if transport_type not in {"unix", "ws", "stdio", "relay"}:
        return None
    if not isinstance(capabilities, list):
        return None

    transport = TransportDescriptor(
        type=transport_type,
        path=transport_data.get("path")
        if isinstance(transport_data.get("path"), str)
        else None,
        url=transport_data.get("url")
        if isinstance(transport_data.get("url"), str)
        else None,
    )

    pid = data.get("pid")
    if not isinstance(pid, int):
        pid = None

    provider_key = data.get("providerKey")
    if not isinstance(provider_key, str):
        provider_key = None

    return ProviderDescriptor(
        id=provider_id,
        name=name,
        slop_version=str(data.get("slop_version") or "0.1"),
        transport=transport,
        capabilities=[str(item) for item in capabilities],
        pid=pid,
        provider_key=provider_key,
        source=source,
    )


def bridge_provider_to_descriptor(provider: BridgeProvider) -> ProviderDescriptor:
    """Convert a bridge-announced provider to a merged descriptor."""
    transport = TransportDescriptor(type="relay")
    if provider.transport == "ws" and provider.url:
        transport = TransportDescriptor(type="ws", url=provider.url)

    return ProviderDescriptor(
        id=provider.provider_key,
        name=provider.name,
        slop_version="1.0",
        transport=transport,
        capabilities=[],
        provider_key=provider.provider_key,
        source="bridge",
    )


def parse_bridge_provider(message: dict[str, Any]) -> BridgeProvider | None:
    """Parse a `provider-available` bridge message."""
    provider_key = message.get("providerKey")
    provider = message.get("provider")

    if not isinstance(provider_key, str) or not provider_key:
        return None
    if not isinstance(provider, dict):
        provider = {}

    raw_tab_id = message.get("tabId")
    tab_id = int(raw_tab_id) if isinstance(raw_tab_id, (int, float)) else 0
    transport = provider.get("transport")
    if transport not in {"ws", "postmessage"}:
        transport = "postmessage"

    provider_id = provider.get("id")
    if not isinstance(provider_id, str) or not provider_id:
        provider_id = provider_key

    name = provider.get("name")
    if not isinstance(name, str) or not name:
        name = "Tab"

    url = provider.get("url")
    if not isinstance(url, str):
        url = None

    return BridgeProvider(
        provider_key=provider_key,
        tab_id=tab_id,
        id=provider_id,
        name=name,
        transport=transport,
        url=url,
    )
