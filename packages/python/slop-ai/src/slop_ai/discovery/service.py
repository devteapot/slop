"""Core discovery service for the Python SDK."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from slop_ai.consumer import SlopConsumer
from slop_ai.transports.unix_client import UnixClientTransport
from slop_ai.transports.ws_client import WebSocketClientTransport

from .bridge import Bridge, BridgeClient, BridgeServer
from .models import (
    ConnectedProvider,
    DiscoveryOptions,
    ProviderDescriptor,
    bridge_provider_to_descriptor,
    descriptor_from_dict,
)
from .relay_transport import BridgeRelayTransport


class DiscoveryService:
    """Discover, connect, and manage local and browser-backed SLOP providers."""

    def __init__(self, options: DiscoveryOptions | None = None) -> None:
        self._options = options or DiscoveryOptions()
        self._providers_dirs = [
            Path(path)
            for path in (self._options.providers_dirs or _default_providers_dirs())
        ]
        self._providers: dict[str, ConnectedProvider] = {}
        self._local_descriptors: list[ProviderDescriptor] = []
        self._last_accessed: dict[str, float] = {}
        self._reconnect_attempts: dict[str, int] = {}
        self._intentional_disconnects: set[str] = set()
        self._connect_tasks: dict[str, asyncio.Task[ConnectedProvider | None]] = {}
        self._reconnect_tasks: dict[str, asyncio.Task[None]] = {}
        self._state_change_handlers: list[Callable[[], None]] = []
        self._bridge: Bridge | None = None
        self._started = False
        self._scan_task: asyncio.Task[None] | None = None
        self._watch_task: asyncio.Task[None] | None = None
        self._idle_task: asyncio.Task[None] | None = None
        self._bridge_task: asyncio.Task[None] | None = None
        self._dir_snapshot: dict[Path, tuple[str, ...]] = {}

    async def start(self) -> None:
        """Start discovery scanning, watching, and bridge management."""
        if self._started:
            return
        self._started = True

        await self._scan()
        self._scan_task = asyncio.create_task(self._scan_loop())
        self._watch_task = asyncio.create_task(self._watch_loop())
        self._idle_task = asyncio.create_task(self._idle_loop())
        self._bridge_task = asyncio.create_task(self._init_bridge())

    async def stop(self) -> None:
        """Stop discovery management and disconnect all providers."""
        if not self._started:
            return
        self._started = False

        tasks = [
            task
            for task in [
                self._bridge_task,
                self._watch_task,
                self._scan_task,
                self._idle_task,
            ]
            if task is not None
        ]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task

        self._bridge_task = None
        self._watch_task = None
        self._scan_task = None
        self._idle_task = None

        reconnect_tasks = list(self._reconnect_tasks.values())
        self._reconnect_tasks.clear()
        for task in reconnect_tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        if self._bridge is not None:
            await self._bridge.stop()
            self._bridge = None

        providers = list(self._providers.values())
        self._providers.clear()
        self._last_accessed.clear()
        self._reconnect_attempts.clear()
        self._intentional_disconnects.clear()
        for provider in providers:
            provider.consumer.disconnect()

    def on_state_change(self, fn: Callable[[], None]) -> None:
        """Register a callback fired on connect, disconnect, and state patch."""
        self._state_change_handlers.append(fn)

    def get_discovered(self) -> list[ProviderDescriptor]:
        """Return all currently known provider descriptors."""
        return [*self._local_descriptors, *self._bridge_descriptors()]

    def get_providers(self) -> list[ConnectedProvider]:
        """Return connected providers."""
        return [
            provider
            for provider in self._providers.values()
            if provider.status == "connected"
        ]

    def get_provider(self, provider_id: str) -> ConnectedProvider | None:
        """Return a connected provider by ID."""
        provider = self._providers.get(provider_id)
        if provider is None or provider.status != "connected":
            return None
        self._last_accessed[provider.id] = asyncio.get_running_loop().time()
        return provider

    async def ensure_connected(self, id_or_name: str) -> ConnectedProvider | None:
        """Return a connected provider by ID or name, connecting it if needed."""
        provider = self._find_connected_provider(id_or_name)
        if provider is not None:
            return provider

        descriptor = self._find_descriptor(id_or_name)
        if descriptor is None:
            return None

        return await self._connect_provider(descriptor)

    def disconnect(self, id_or_name: str) -> bool:
        """Disconnect a provider by ID or fuzzy name."""
        provider = self._find_any_provider(id_or_name)
        if provider is None:
            return False

        self._intentional_disconnects.add(provider.id)
        provider.consumer.disconnect()
        self._forget_provider(provider.id)
        self._fire_state_change()
        return True

    async def _init_bridge(self) -> None:
        client = BridgeClient(
            self._options.bridge_url,
            logger=self._options.logger,
            reconnect_delay=self._options.bridge_retry_delay,
            dial_timeout=self._options.bridge_dial_timeout,
        )

        try:
            await client.connect_once()
        except Exception:
            if not self._options.host_bridge:
                client.start()
                self._attach_bridge(client)
                return

            try:
                server = BridgeServer(
                    self._options.bridge_url, logger=self._options.logger
                )
                await server.start()
            except Exception:
                client.start()
                self._attach_bridge(client)
                return

            self._attach_bridge(server)
            return

        client.start()
        self._attach_bridge(client)

    def _attach_bridge(self, bridge: Bridge) -> None:
        self._bridge = bridge

        def _on_provider_change() -> None:
            asyncio.create_task(self._scan())

        bridge.on_provider_change(_on_provider_change)
        asyncio.create_task(self._scan())

    async def _scan_loop(self) -> None:
        try:
            while self._started:
                await asyncio.sleep(self._options.scan_interval)
                await self._scan()
        except asyncio.CancelledError:
            return

    async def _watch_loop(self) -> None:
        try:
            while self._started:
                changed = False
                for directory in self._providers_dirs:
                    snapshot = _directory_signature(directory)
                    if self._dir_snapshot.get(directory) != snapshot:
                        self._dir_snapshot[directory] = snapshot
                        changed = True
                if changed:
                    await self._scan()
                await asyncio.sleep(self._options.watch_interval)
        except asyncio.CancelledError:
            return

    async def _idle_loop(self) -> None:
        try:
            while self._started:
                await asyncio.sleep(60.0)
                self._check_idle()
        except asyncio.CancelledError:
            return

    async def _scan(self) -> None:
        self._local_descriptors = self._read_descriptors()
        all_descriptors = self.get_discovered()
        all_ids = {desc.id for desc in all_descriptors}
        disconnected = False

        for provider_id, provider in list(self._providers.items()):
            if provider_id not in all_ids:
                self._intentional_disconnects.add(provider_id)
                provider.consumer.disconnect()
                self._forget_provider(provider_id)
                disconnected = True

        if disconnected:
            self._fire_state_change()

        if not self._options.auto_connect:
            return

        for descriptor in all_descriptors:
            if descriptor.id in self._providers or descriptor.id in self._connect_tasks:
                continue
            asyncio.create_task(self._connect_provider(descriptor))

    async def _connect_provider(
        self, descriptor: ProviderDescriptor
    ) -> ConnectedProvider | None:
        existing = self._providers.get(descriptor.id)
        if existing is not None and existing.status == "connected":
            self._last_accessed[descriptor.id] = asyncio.get_running_loop().time()
            return existing

        task = self._connect_tasks.get(descriptor.id)
        if task is not None:
            return await task

        async def _run() -> ConnectedProvider | None:
            try:
                transport = self._create_transport(descriptor)
            except Exception as exc:
                self._log_error(
                    f"[slop] Failed to create transport for {descriptor.name}: {exc}"
                )
                return None
            if transport is None:
                self._log_info(
                    f"[slop] Skipping {descriptor.name}: unsupported transport {descriptor.transport.type}"
                )
                return None

            provider = ConnectedProvider(
                id=descriptor.id,
                name=descriptor.name,
                descriptor=descriptor,
                consumer=SlopConsumer(transport, timeout=self._options.connect_timeout),
                subscription_id="",
                status="connecting",
            )
            self._providers[descriptor.id] = provider

            try:
                hello = await asyncio.wait_for(
                    provider.consumer.connect(), timeout=self._options.connect_timeout
                )
                subscription = await asyncio.wait_for(
                    provider.consumer.subscribe("/", -1),
                    timeout=self._options.connect_timeout,
                )
            except Exception as exc:
                self._providers.pop(descriptor.id, None)
                self._log_error(f"[slop] Failed to connect to {descriptor.name}: {exc}")
                return None

            provider.name = _provider_name(hello, descriptor.name)
            provider.subscription_id = subscription["id"]
            provider.status = "connected"
            self._last_accessed[descriptor.id] = asyncio.get_running_loop().time()
            self._reconnect_attempts.pop(descriptor.id, None)
            self._intentional_disconnects.discard(descriptor.id)

            provider.consumer.on_patch(lambda *_: self._fire_state_change())

            def _on_disconnect(
                provider_id: str = descriptor.id,
                name: str = provider.name,
                desc: ProviderDescriptor = descriptor,
            ) -> None:
                asyncio.create_task(
                    self._handle_provider_disconnect(provider_id, name, desc)
                )

            provider.consumer.on_disconnect(_on_disconnect)
            provider.consumer.on_error(
                lambda msg, provider_id=descriptor.id: self._log_error(
                    f"[slop] Provider {provider_id} error: {msg}"
                )
            )

            self._fire_state_change()
            return provider

        task = asyncio.create_task(_run())
        self._connect_tasks[descriptor.id] = task
        try:
            return await task
        finally:
            self._connect_tasks.pop(descriptor.id, None)

    async def _handle_provider_disconnect(
        self, provider_id: str, name: str, descriptor: ProviderDescriptor
    ) -> None:
        self._forget_provider(provider_id)
        self._fire_state_change()

        if provider_id in self._intentional_disconnects:
            self._intentional_disconnects.discard(provider_id)
            return
        if self._find_descriptor(provider_id) is None:
            return
        if not self._started:
            return

        attempt = self._reconnect_attempts.get(provider_id, 0) + 1
        self._reconnect_attempts[provider_id] = attempt
        delay = min(
            self._options.reconnect_base_delay * (2 ** (attempt - 1)),
            self._options.max_reconnect_delay,
        )
        self._log_info(
            f"[slop] Will reconnect to {name} in {delay:.1f}s (attempt {attempt})"
        )

        async def _retry() -> None:
            try:
                await asyncio.sleep(delay)
                if self._started and provider_id not in self._providers:
                    await self._connect_provider(descriptor)
            except asyncio.CancelledError:
                return

        old_task = self._reconnect_tasks.pop(provider_id, None)
        if old_task is not None:
            old_task.cancel()
        self._reconnect_tasks[provider_id] = asyncio.create_task(_retry())

    def _check_idle(self) -> None:
        now = asyncio.get_running_loop().time()
        for provider_id, last_accessed in list(self._last_accessed.items()):
            if now - last_accessed <= self._options.idle_timeout:
                continue
            provider = self._providers.get(provider_id)
            if provider is None:
                continue
            self._intentional_disconnects.add(provider_id)
            provider.consumer.disconnect()
            self._forget_provider(provider_id)
            self._fire_state_change()

    def _read_descriptors(self) -> list[ProviderDescriptor]:
        descriptors: list[ProviderDescriptor] = []
        for directory in self._providers_dirs:
            if not directory.exists():
                continue
            for path in directory.glob("*.json"):
                try:
                    data = json.loads(path.read_text())
                except Exception as exc:
                    self._log_error(f"[slop] Failed to parse {path.name}: {exc}")
                    continue
                descriptor = descriptor_from_dict(data, source="local")
                if descriptor is None:
                    self._log_error(f"[slop] Invalid descriptor in {path.name}")
                    continue
                descriptors.append(descriptor)
        return descriptors

    def _bridge_descriptors(self) -> list[ProviderDescriptor]:
        if self._bridge is None or not self._bridge.running():
            return []
        return [
            bridge_provider_to_descriptor(provider)
            for provider in self._bridge.providers()
        ]

    def _create_transport(self, descriptor: ProviderDescriptor) -> Any | None:
        if descriptor.transport.type == "unix" and descriptor.transport.path:
            return UnixClientTransport(descriptor.transport.path)
        if descriptor.transport.type == "ws" and descriptor.transport.url:
            return WebSocketClientTransport(descriptor.transport.url)
        if (
            descriptor.transport.type == "relay"
            and descriptor.provider_key
            and self._bridge is not None
        ):
            return BridgeRelayTransport(self._bridge, descriptor.provider_key)
        return None

    def _find_connected_provider(self, id_or_name: str) -> ConnectedProvider | None:
        provider = self._providers.get(id_or_name)
        if provider is not None and provider.status == "connected":
            self._last_accessed[provider.id] = asyncio.get_running_loop().time()
            return provider

        needle = id_or_name.lower()
        for provider in self._providers.values():
            if provider.status == "connected" and needle in provider.name.lower():
                self._last_accessed[provider.id] = asyncio.get_running_loop().time()
                return provider
        return None

    def _find_any_provider(self, id_or_name: str) -> ConnectedProvider | None:
        provider = self._providers.get(id_or_name)
        if provider is not None:
            return provider

        needle = id_or_name.lower()
        for provider in self._providers.values():
            if needle in provider.name.lower():
                return provider
        return None

    def _find_descriptor(self, id_or_name: str) -> ProviderDescriptor | None:
        needle = id_or_name.lower()
        for descriptor in self.get_discovered():
            if descriptor.id == id_or_name or needle in descriptor.name.lower():
                return descriptor
        return None

    def _forget_provider(self, provider_id: str) -> None:
        self._providers.pop(provider_id, None)
        self._last_accessed.pop(provider_id, None)
        self._reconnect_attempts.pop(provider_id, None)
        reconnect_task = self._reconnect_tasks.pop(provider_id, None)
        if reconnect_task is not None:
            reconnect_task.cancel()

    def _fire_state_change(self) -> None:
        for handler in self._state_change_handlers:
            handler()

    def _log_info(self, message: str) -> None:
        if self._options.logger is None:
            return
        info = getattr(self._options.logger, "info", None)
        if callable(info):
            info(message)

    def _log_error(self, message: str) -> None:
        if self._options.logger is None:
            return
        error = getattr(self._options.logger, "error", None)
        if callable(error):
            error(message)


def create_discovery_service(
    options: DiscoveryOptions | None = None,
) -> DiscoveryService:
    """Create a discovery service using the phase-1 core contract."""
    return DiscoveryService(options=options)


def _default_providers_dirs() -> list[str]:
    home = Path.home()
    return [
        str(home / ".slop" / "providers"),
        str(Path(os.getenv("TMPDIR", "/tmp")) / "slop" / "providers"),
    ]


def _directory_signature(directory: Path) -> tuple[str, ...]:
    if not directory.exists():
        return ()

    signature: list[str] = []
    for path in sorted(directory.glob("*.json")):
        try:
            stat = path.stat()
        except OSError:
            continue
        signature.append(f"{path.name}:{stat.st_mtime_ns}:{stat.st_size}")
    return tuple(signature)


def _provider_name(hello: dict[str, Any], fallback: str) -> str:
    provider = hello.get("provider")
    if isinstance(provider, dict):
        name = provider.get("name")
        if isinstance(name, str) and name:
            return name
    return fallback
