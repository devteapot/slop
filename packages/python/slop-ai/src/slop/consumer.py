"""SlopConsumer — async client that subscribes to a SLOP provider."""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Protocol

from .types import SlopNode, PatchOp
from .state_mirror import StateMirror


# ---------------------------------------------------------------
# Transport protocols
# ---------------------------------------------------------------

class ClientConnection(Protocol):
    """A single connection to a SLOP provider."""

    async def send(self, message: dict[str, Any]) -> None: ...
    def on_message(self, handler: Callable[[dict[str, Any]], None]) -> None: ...
    def on_close(self, handler: Callable[[], None]) -> None: ...
    async def close(self) -> None: ...


class ClientTransport(Protocol):
    """Factory that creates a :class:`ClientConnection`."""

    async def connect(self) -> ClientConnection: ...


# ---------------------------------------------------------------
# Event callback types
# ---------------------------------------------------------------

PatchHandler = Callable[[str, list[dict[str, Any]], int], None]
DisconnectHandler = Callable[[], None]
ErrorHandler = Callable[[dict[str, Any]], None]
EventHandler = Callable[[str, Any], None]


# ---------------------------------------------------------------
# Consumer
# ---------------------------------------------------------------

class SlopConsumer:
    """Async consumer that connects to a SLOP provider.

    Usage::

        consumer = SlopConsumer(WebSocketClientTransport("ws://localhost:8080"))
        hello = await consumer.connect()
        sub = await consumer.subscribe("/")
        tree = consumer.get_tree(sub["id"])
    """

    def __init__(self, transport: ClientTransport) -> None:
        self._transport = transport
        self._connection: ClientConnection | None = None
        self._mirrors: dict[str, StateMirror] = {}
        self._pending: dict[str, asyncio.Future[Any]] = {}
        self._sub_counter = 0
        self._req_counter = 0

        # Event callbacks
        self._on_patch: list[PatchHandler] = []
        self._on_disconnect: list[DisconnectHandler] = []
        self._on_error: list[ErrorHandler] = []
        self._on_event: list[EventHandler] = []

    # -- public event registration ----------------------------------

    def on_patch(self, handler: PatchHandler) -> None:
        """Register a handler called on every patch: ``handler(sub_id, ops, version)``."""
        self._on_patch.append(handler)

    def on_disconnect(self, handler: DisconnectHandler) -> None:
        """Register a handler called when the connection closes."""
        self._on_disconnect.append(handler)

    def on_error(self, handler: ErrorHandler) -> None:
        """Register a handler called on ``error`` messages: ``handler(msg)``."""
        self._on_error.append(handler)

    def on_event(self, handler: EventHandler) -> None:
        """Register a handler called on ``event`` messages: ``handler(name, data)``."""
        self._on_event.append(handler)

    # -- lifecycle ---------------------------------------------------

    async def connect(self) -> dict[str, Any]:
        """Connect to the provider and return the ``hello`` message."""
        self._connection = await self._transport.connect()
        loop = asyncio.get_running_loop()
        hello_future: asyncio.Future[dict[str, Any]] = loop.create_future()

        def _on_first(msg: dict[str, Any]) -> None:
            if msg.get("type") == "hello":
                if not hello_future.done():
                    hello_future.set_result(msg)
                # Switch to normal message handling after hello
                self._connection.on_message(self._handle_message)  # type: ignore[union-attr]

        self._connection.on_message(_on_first)
        self._connection.on_close(self._handle_close)

        return await hello_future

    def disconnect(self) -> None:
        """Close the connection."""
        if self._connection is not None:
            asyncio.ensure_future(self._connection.close())
            self._connection = None

    # -- operations --------------------------------------------------

    async def subscribe(self, path: str = "/", depth: int = 1) -> dict[str, Any]:
        """Subscribe to *path* and return ``{"id": ..., "snapshot": SlopNode}``."""
        self._sub_counter += 1
        sub_id = f"sub-{self._sub_counter}"

        future = self._make_future(sub_id)
        await self._send({"type": "subscribe", "id": sub_id, "path": path, "depth": depth})
        snapshot_tree: SlopNode = await future
        return {"id": sub_id, "snapshot": snapshot_tree}

    def unsubscribe(self, sub_id: str) -> None:
        """Unsubscribe from a subscription."""
        self._mirrors.pop(sub_id, None)
        if self._connection is not None:
            asyncio.ensure_future(self._send({"type": "unsubscribe", "id": sub_id}))

    async def query(self, path: str = "/", depth: int = 1) -> SlopNode:
        """One-shot query for a subtree."""
        self._req_counter += 1
        qid = f"q-{self._req_counter}"

        future = self._make_future(qid)
        await self._send({"type": "query", "id": qid, "path": path, "depth": depth})
        return await future

    async def invoke(
        self,
        path: str,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Invoke an affordance and return the result message."""
        self._req_counter += 1
        inv_id = f"inv-{self._req_counter}"

        msg: dict[str, Any] = {
            "type": "invoke",
            "id": inv_id,
            "path": path,
            "action": action,
        }
        if params is not None:
            msg["params"] = params

        future = self._make_future(inv_id)
        await self._send(msg)
        return await future

    def get_tree(self, subscription_id: str) -> SlopNode | None:
        """Return current tree for a subscription, or ``None``."""
        mirror = self._mirrors.get(subscription_id)
        return mirror.get_tree() if mirror else None

    # -- internal ----------------------------------------------------

    def _make_future(self, request_id: str) -> asyncio.Future[Any]:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[request_id] = future
        return future

    async def _send(self, message: dict[str, Any]) -> None:
        if self._connection is None:
            raise RuntimeError("Not connected")
        await self._connection.send(message)

    def _handle_message(self, msg: dict[str, Any]) -> None:
        msg_type = msg.get("type")

        if msg_type == "snapshot":
            sub_id = msg["id"]
            existed = sub_id in self._mirrors
            mirror = StateMirror(msg)
            self._mirrors[sub_id] = mirror

            future = self._pending.pop(sub_id, None)
            if future is not None and not future.done():
                future.set_result(mirror.get_tree())
            elif existed:
                self._emit_patch(sub_id, [], msg.get("version", 0))

        elif msg_type == "patch":
            sub_id = msg["subscription"]
            mirror = self._mirrors.get(sub_id)
            if mirror is not None:
                mirror.apply_patch(msg)
                self._emit_patch(sub_id, msg.get("ops", []), msg.get("version", 0))

        elif msg_type == "result":
            future = self._pending.pop(msg.get("id", ""), None)
            if future is not None and not future.done():
                future.set_result(msg)

        elif msg_type == "error":
            error_id = msg.get("id", "")
            future = self._pending.pop(error_id, None)
            if future is not None and not future.done():
                exc = RuntimeError(msg.get("error", {}).get("message", "Unknown error"))
                future.set_exception(exc)
            for handler in self._on_error:
                handler(msg)

        elif msg_type == "batch":
            for inner in msg.get("messages", []):
                self._handle_message(inner)

        elif msg_type == "event":
            for handler in self._on_event:
                handler(msg.get("name", ""), msg.get("data"))

    def _handle_close(self) -> None:
        for handler in self._on_disconnect:
            handler()

    def _emit_patch(self, sub_id: str, ops: list[dict[str, Any]], version: int) -> None:
        for handler in self._on_patch:
            handler(sub_id, ops, version)
