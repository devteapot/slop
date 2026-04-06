"""Relay transport for postMessage browser providers."""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from slop_ai.consumer import ClientConnection, ClientTransport

from .bridge import Bridge, RelayHandler


class BridgeRelayConnection:
    """Client connection that relays SLOP messages through the bridge."""

    def __init__(
        self, bridge: Bridge, provider_key: str, relay_handler: RelayHandler
    ) -> None:
        self._bridge = bridge
        self._provider_key = provider_key
        self._relay_handler = relay_handler
        self._message_handlers: list[Callable[[dict[str, Any]], None]] = []
        self._close_handlers: list[Callable[[], None]] = []
        self._early_messages: list[dict[str, Any]] = []
        self._buffering = True
        self._closed = False

    async def send(self, message: dict[str, Any]) -> None:
        if self._closed:
            return
        await self._bridge.send(
            {
                "type": "slop-relay",
                "providerKey": self._provider_key,
                "message": message,
            }
        )

    def on_message(self, handler: Callable[[dict[str, Any]], None]) -> None:
        self._message_handlers.append(handler)
        if self._buffering:
            self._buffering = False
            early_messages = list(self._early_messages)
            self._early_messages.clear()
            for message in early_messages:
                handler(message)

    def on_close(self, handler: Callable[[], None]) -> None:
        self._close_handlers.append(handler)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._bridge.send(
            {"type": "relay-close", "providerKey": self._provider_key}
        )
        self._bridge.unsubscribe_relay(self._provider_key, self._relay_handler)
        for handler in list(self._close_handlers):
            handler()

    def handle_message(self, message: dict[str, Any]) -> None:
        if self._buffering:
            self._early_messages.append(message)
        for handler in list(self._message_handlers):
            handler(message)


class BridgeRelayTransport(ClientTransport):
    """Relay browser-tab SLOP messages through the extension bridge."""

    def __init__(self, bridge: Bridge, provider_key: str) -> None:
        self._bridge = bridge
        self._provider_key = provider_key

    async def connect(self) -> ClientConnection:
        got_response = asyncio.Event()
        connection: BridgeRelayConnection | None = None

        def _relay_handler(message: dict[str, Any]) -> None:
            got_response.set()
            if connection is not None:
                connection.handle_message(message)

        connection = BridgeRelayConnection(
            self._bridge, self._provider_key, _relay_handler
        )
        self._bridge.subscribe_relay(self._provider_key, _relay_handler)

        await self._bridge.send(
            {"type": "relay-open", "providerKey": self._provider_key}
        )

        for _ in range(4):
            await self._bridge.send(
                {
                    "type": "slop-relay",
                    "providerKey": self._provider_key,
                    "message": {"type": "connect"},
                }
            )
            try:
                await asyncio.wait_for(got_response.wait(), timeout=0.3)
                break
            except asyncio.TimeoutError:
                continue

        return connection
