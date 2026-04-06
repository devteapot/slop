"""Bridge client and server for browser-backed SLOP providers."""

from __future__ import annotations

import asyncio
import contextlib
import importlib
import json
from collections import defaultdict
from typing import Any, Callable, Protocol
from urllib.parse import urlparse

from .models import BridgeProvider, parse_bridge_provider

RelayHandler = Callable[[dict[str, Any]], None]
ProviderChangeHandler = Callable[[], None]

WsClientConnection = Any
WsServer = Any
WsServerConnection = Any

try:
    ws_connect = importlib.import_module("websockets.asyncio.client").connect
    ws_serve = importlib.import_module("websockets.asyncio.server").serve
except ImportError:  # pragma: no cover - exercised by import sites
    ws_connect = None  # type: ignore[assignment]
    ws_serve = None  # type: ignore[assignment]


class Bridge(Protocol):
    """Shared interface for bridge client and server."""

    def running(self) -> bool: ...
    def providers(self) -> list[BridgeProvider]: ...
    def on_provider_change(self, fn: ProviderChangeHandler) -> None: ...
    def subscribe_relay(self, provider_key: str, handler: RelayHandler) -> None: ...
    def unsubscribe_relay(self, provider_key: str, handler: RelayHandler) -> None: ...
    async def send(self, message: dict[str, Any]) -> None: ...
    async def stop(self) -> None: ...


class BridgeClient:
    """Connects to an existing bridge and mirrors provider announcements."""

    def __init__(
        self,
        url: str,
        *,
        logger: Any | None = None,
        reconnect_delay: float = 5.0,
        dial_timeout: float = 1.0,
    ) -> None:
        self._url = url
        self._logger = logger
        self._reconnect_delay = reconnect_delay
        self._dial_timeout = dial_timeout
        self._ws: WsClientConnection | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._reconnect_task: asyncio.Task[None] | None = None
        self._providers: dict[str, BridgeProvider] = {}
        self._relay_subscribers: dict[str, list[RelayHandler]] = defaultdict(list)
        self._running = False
        self._started = False
        self._provider_change_handlers: list[ProviderChangeHandler] = []

    async def connect_once(self) -> None:
        """Try a single connection attempt."""
        if ws_connect is None:
            raise ImportError(
                "Install websockets to use slop_ai.discovery bridge support"
            )
        if self._ws is not None:
            return

        assert ws_connect is not None
        self._ws = await ws_connect(self._url, open_timeout=self._dial_timeout)
        self._running = True
        self._reader_task = asyncio.create_task(self._read_loop())
        self._log_info(f"[slop-bridge] Connected to existing bridge at {self._url}")

    def start(self) -> None:
        """Enable reconnect behavior for future disconnects."""
        if self._started:
            return
        self._started = True
        if self._ws is None:
            self._schedule_reconnect(0.0)

    async def stop(self) -> None:
        """Stop reconnecting and close the bridge connection."""
        self._started = False

        if self._reconnect_task is not None:
            self._reconnect_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reconnect_task
            self._reconnect_task = None

        if self._reader_task is not None:
            self._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_task
            self._reader_task = None

        if self._ws is not None:
            await self._ws.close()
            self._ws = None

        providers_changed = bool(self._providers)
        self._providers.clear()
        self._relay_subscribers.clear()
        self._running = False
        if providers_changed:
            self._emit_provider_change()

    def running(self) -> bool:
        return self._running

    def providers(self) -> list[BridgeProvider]:
        return list(self._providers.values())

    def on_provider_change(self, fn: ProviderChangeHandler) -> None:
        self._provider_change_handlers.append(fn)

    def subscribe_relay(self, provider_key: str, handler: RelayHandler) -> None:
        self._relay_subscribers[provider_key].append(handler)

    def unsubscribe_relay(self, provider_key: str, handler: RelayHandler) -> None:
        handlers = self._relay_subscribers.get(provider_key)
        if not handlers:
            return
        with contextlib.suppress(ValueError):
            handlers.remove(handler)
        if not handlers:
            self._relay_subscribers.pop(provider_key, None)

    async def send(self, message: dict[str, Any]) -> None:
        if self._ws is None:
            raise RuntimeError("Bridge client is not connected")
        await self._ws.send(json.dumps(message))

    async def _read_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                message = json.loads(raw)
                self._handle_message(message)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._log_error("[slop-bridge] Bridge client read error")
        finally:
            await self._handle_disconnect()

    async def _handle_disconnect(self) -> None:
        if self._ws is None and not self._running:
            return

        self._ws = None
        self._running = False
        providers_changed = bool(self._providers)
        self._providers.clear()
        self._relay_subscribers.clear()
        if providers_changed:
            self._emit_provider_change()

        if self._started:
            self._schedule_reconnect(self._reconnect_delay)

    def _schedule_reconnect(self, delay: float) -> None:
        if not self._started or self._reconnect_task is not None:
            return

        async def _retry() -> None:
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                while self._started and self._ws is None:
                    try:
                        await self.connect_once()
                        return
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        await asyncio.sleep(self._reconnect_delay)
            finally:
                self._reconnect_task = None

        self._reconnect_task = asyncio.create_task(_retry())

    def _handle_message(self, message: dict[str, Any]) -> None:
        message_type = message.get("type")

        if message_type == "provider-available":
            provider = parse_bridge_provider(message)
            if provider is None:
                return
            self._providers[provider.provider_key] = provider
            self._emit_provider_change()
            return

        if message_type == "provider-unavailable":
            provider_key = message.get("providerKey")
            if not isinstance(provider_key, str) or not provider_key:
                return
            self._providers.pop(provider_key, None)
            self._relay_subscribers.pop(provider_key, None)
            self._emit_provider_change()
            return

        if message_type == "slop-relay":
            provider_key = message.get("providerKey")
            payload = message.get("message")
            if not isinstance(provider_key, str) or not isinstance(payload, dict):
                return
            for handler in list(self._relay_subscribers.get(provider_key, [])):
                handler(payload)

    def _emit_provider_change(self) -> None:
        for handler in self._provider_change_handlers:
            handler()

    def _log_info(self, message: str) -> None:
        if self._logger is None:
            return
        info = getattr(self._logger, "info", None)
        if callable(info):
            info(message)

    def _log_error(self, message: str) -> None:
        if self._logger is None:
            return
        error = getattr(self._logger, "error", None)
        if callable(error):
            error(message)


class BridgeServer:
    """Hosts the extension bridge locally for browser-backed providers."""

    def __init__(self, url: str, *, logger: Any | None = None) -> None:
        if ws_serve is None:
            raise ImportError(
                "Install websockets to use slop_ai.discovery bridge support"
            )

        parsed = urlparse(url)
        self._host = parsed.hostname or "127.0.0.1"
        self._port = parsed.port or 9339
        self._path = parsed.path or "/slop-bridge"
        self._logger = logger
        self._server: WsServer | None = None
        self._sinks: set[WsServerConnection] = set()
        self._providers: dict[str, BridgeProvider] = {}
        self._relay_subscribers: dict[str, list[RelayHandler]] = defaultdict(list)
        self._provider_change_handlers: list[ProviderChangeHandler] = []
        self._running = False

    async def start(self) -> None:
        assert ws_serve is not None
        self._server = await ws_serve(self._handle_connection, self._host, self._port)
        self._running = True

    async def stop(self) -> None:
        self._running = False
        providers_changed = bool(self._providers)
        self._providers.clear()
        self._relay_subscribers.clear()

        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

        sinks = list(self._sinks)
        self._sinks.clear()
        for sink in sinks:
            with contextlib.suppress(Exception):
                await sink.close()

        if providers_changed:
            self._emit_provider_change()

    def running(self) -> bool:
        return self._running

    def providers(self) -> list[BridgeProvider]:
        return list(self._providers.values())

    def on_provider_change(self, fn: ProviderChangeHandler) -> None:
        self._provider_change_handlers.append(fn)

    def subscribe_relay(self, provider_key: str, handler: RelayHandler) -> None:
        self._relay_subscribers[provider_key].append(handler)

    def unsubscribe_relay(self, provider_key: str, handler: RelayHandler) -> None:
        handlers = self._relay_subscribers.get(provider_key)
        if not handlers:
            return
        with contextlib.suppress(ValueError):
            handlers.remove(handler)
        if not handlers:
            self._relay_subscribers.pop(provider_key, None)

    async def send(self, message: dict[str, Any]) -> None:
        await self._broadcast(message)

    async def _broadcast(self, message: dict[str, Any]) -> None:
        if not self._sinks:
            return
        payload = json.dumps(message)
        for sink in list(self._sinks):
            try:
                await sink.send(payload)
            except Exception:
                self._sinks.discard(sink)

    async def _handle_connection(self, ws: WsServerConnection) -> None:
        if ws.request and ws.request.path != self._path:
            await ws.close(4004, f"Not found: {ws.request.path}")
            return

        self._sinks.add(ws)
        for provider in self._providers.values():
            message = {
                "type": "provider-available",
                "tabId": provider.tab_id,
                "providerKey": provider.provider_key,
                "provider": {
                    "id": provider.id,
                    "name": provider.name,
                    "transport": provider.transport,
                },
            }
            if provider.url:
                message["provider"]["url"] = provider.url
            await ws.send(json.dumps(message))

        try:
            async for raw in ws:
                await self._handle_message(json.loads(raw))
        finally:
            self._sinks.discard(ws)
            if not self._sinks:
                providers_changed = bool(self._providers)
                self._providers.clear()
                self._relay_subscribers.clear()
                if providers_changed:
                    self._emit_provider_change()

    async def _handle_message(self, message: dict[str, Any]) -> None:
        message_type = message.get("type")

        if message_type == "provider-available":
            provider = parse_bridge_provider(message)
            if provider is None:
                return
            self._providers[provider.provider_key] = provider
            await self._broadcast(message)
            self._emit_provider_change()
            return

        if message_type == "provider-unavailable":
            provider_key = message.get("providerKey")
            if not isinstance(provider_key, str) or not provider_key:
                return
            self._providers.pop(provider_key, None)
            self._relay_subscribers.pop(provider_key, None)
            await self._broadcast(message)
            self._emit_provider_change()
            return

        if message_type == "slop-relay":
            provider_key = message.get("providerKey")
            payload = message.get("message")
            if not isinstance(provider_key, str) or not isinstance(payload, dict):
                return
            for handler in list(self._relay_subscribers.get(provider_key, [])):
                handler(payload)
            await self._broadcast(message)
            return

        if message_type in {"relay-open", "relay-close"}:
            await self._broadcast(message)

    def _emit_provider_change(self) -> None:
        for handler in self._provider_change_handlers:
            handler()
