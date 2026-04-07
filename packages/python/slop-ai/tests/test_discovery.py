from __future__ import annotations

import asyncio
import contextlib
import importlib
import json
import socket
from pathlib import Path
from typing import Any, cast

import pytest

from slop_ai.discovery import (
    BridgeRelayTransport,
    BridgeServer,
    DiscoveryOptions,
    DiscoveryService,
)
from slop_ai.discovery.models import (
    ConnectedProvider,
    ProviderDescriptor,
    TransportDescriptor,
)


def test_service_scans_and_prunes_descriptors(tmp_path: Path) -> None:
    async def _run() -> None:
        descriptor_path = tmp_path / "test-app.json"
        descriptor_path.write_text(
            json.dumps(
                {
                    "id": "test-app",
                    "name": "Test App",
                    "slop_version": "0.1",
                    "transport": {"type": "unix", "path": "/tmp/slop/test-app.sock"},
                    "capabilities": ["state"],
                }
            )
        )

        service = DiscoveryService(
            DiscoveryOptions(
                providers_dirs=[str(tmp_path)],
                bridge_url="ws://127.0.0.1:1/slop-bridge",
                host_bridge=False,
                scan_interval=0.05,
                watch_interval=0.02,
                bridge_retry_delay=0.05,
                bridge_dial_timeout=0.05,
            )
        )

        await service.start()
        try:
            await _wait_until(lambda: len(service.get_discovered()) == 1)
            descriptor_path.unlink()
            await _wait_until(lambda: len(service.get_discovered()) == 0)
        finally:
            await service.stop()

    asyncio.run(_run())


def test_bridge_server_forwards_relay_control_messages() -> None:
    pytest.importorskip("websockets")

    async def _run() -> None:
        connect = importlib.import_module("websockets.asyncio.client").connect
        port = _free_port()
        url = f"ws://127.0.0.1:{port}/slop-bridge"

        server = BridgeServer(url)
        await server.start()
        try:
            async with connect(url) as client_one, connect(url) as client_two:
                await client_one.send(
                    json.dumps({"type": "relay-open", "providerKey": "tab-1"})
                )
                message = json.loads(
                    await asyncio.wait_for(client_two.recv(), timeout=1.0)
                )
                assert message["type"] == "relay-open"

                await client_one.send(
                    json.dumps({"type": "relay-close", "providerKey": "tab-1"})
                )
                message = json.loads(
                    await asyncio.wait_for(client_two.recv(), timeout=1.0)
                )
                assert message["type"] == "relay-close"
        finally:
            await server.stop()

    asyncio.run(_run())


def test_relay_transport_buffers_early_messages() -> None:
    async def _run() -> None:
        bridge = _FakeBridge()
        transport = BridgeRelayTransport(bridge, "tab-1")
        connection = await transport.connect()
        try:
            message_future: asyncio.Future[dict[str, Any]] = (
                asyncio.get_running_loop().create_future()
            )
            connection.on_message(
                lambda message: (
                    message_future.set_result(message)
                    if not message_future.done()
                    else None
                )
            )
            message = await asyncio.wait_for(message_future, timeout=1.0)
            assert message["type"] == "hello"
        finally:
            await connection.close()

    asyncio.run(_run())


def test_service_matching_rejects_empty_and_ambiguous_app_names() -> None:
    async def _run() -> None:
        service = DiscoveryService(DiscoveryOptions(providers_dirs=[]))
        service._local_descriptors = [
            ProviderDescriptor(
                id="canvas-app",
                name="Canvas App",
                slop_version="0.1",
                transport=TransportDescriptor(type="unix", path="/tmp/canvas.sock"),
                capabilities=["state"],
            ),
            ProviderDescriptor(
                id="canvas-pro",
                name="Canvas Pro",
                slop_version="0.1",
                transport=TransportDescriptor(type="unix", path="/tmp/canvas-pro.sock"),
                capabilities=["state"],
            ),
        ]
        service._providers = {
            "canvas-app": ConnectedProvider(
                id="canvas-app",
                name="Canvas App",
                descriptor=service._local_descriptors[0],
                consumer=cast(Any, _FakeConsumer()),
                subscription_id="sub-1",
                status="connected",
            )
        }

        assert service._find_descriptor("") is None
        assert service._find_descriptor("   ") is None
        assert service._find_connected_provider("") is None
        assert service._find_any_provider("   ") is None
        assert service._find_descriptor("canvas") is None
        assert service._find_descriptor("canvas-app") is not None
        assert service._find_descriptor("Canvas App") is not None
        assert service._find_connected_provider("Canvas App") is not None

    asyncio.run(_run())


def test_service_matching_supports_normalized_unique_matches() -> None:
    service = DiscoveryService(DiscoveryOptions(providers_dirs=[]))
    descriptor = ProviderDescriptor(
        id="whiteboard-canvas",
        name="Whiteboard Canvas",
        slop_version="0.1",
        transport=TransportDescriptor(type="unix", path="/tmp/whiteboard.sock"),
        capabilities=["state"],
    )
    service._local_descriptors = [descriptor]

    assert service._find_descriptor("whiteboard canvas") == descriptor
    assert service._find_descriptor("WhiteboardCanvas") == descriptor
    assert service._find_descriptor("board") == descriptor


async def _wait_until(predicate: Any, timeout: float = 1.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met before timeout")


def _free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class _FakeBridge:
    def __init__(self) -> None:
        self._subs: dict[str, list[Any]] = {}

    def running(self) -> bool:
        return True

    def providers(self) -> list[Any]:
        return []

    def on_provider_change(self, fn: Any) -> None:
        return None

    def subscribe_relay(self, provider_key: str, handler: Any) -> None:
        self._subs.setdefault(provider_key, []).append(handler)

    def unsubscribe_relay(self, provider_key: str, handler: Any) -> None:
        with contextlib.suppress(ValueError):
            self._subs.get(provider_key, []).remove(handler)

    async def send(self, message: dict[str, Any]) -> None:
        if message.get("type") != "slop-relay":
            return
        payload = message.get("message")
        provider_key = message.get("providerKey")
        if not isinstance(payload, dict) or payload.get("type") != "connect":
            return
        if not isinstance(provider_key, str):
            return
        for handler in list(self._subs.get(provider_key, [])):
            handler({"type": "hello", "provider": {"name": "Browser App"}})

    def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None


class _FakeConsumer:
    def disconnect(self) -> None:
        return None
