"""ASGI transport for SLOP — integrates with FastAPI, Starlette, and other ASGI frameworks.

Usage with FastAPI::

    from fastapi import FastAPI
    from slop import SlopServer
    from slop.transports.asgi import SlopMiddleware

    app = FastAPI()
    slop = SlopServer("my-api", "My API")

    app.add_middleware(SlopMiddleware, slop=slop)

Or mount as a standalone ASGI app::

    from slop.transports.asgi import asgi_app
    app.mount("/", asgi_app(slop))
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Awaitable

from slop.server import SlopServer

# ASGI type aliases
Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


class _WebSocketConnection:
    """Wraps an ASGI WebSocket as a SLOP Connection."""

    def __init__(self, send: Send) -> None:
        self._send = send
        self._closed = False

    def send(self, message: dict[str, Any]) -> None:
        if not self._closed:
            asyncio.ensure_future(self._send({
                "type": "websocket.send",
                "text": json.dumps(message),
            }))

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            asyncio.ensure_future(self._send({
                "type": "websocket.close",
                "code": 1000,
            }))


class SlopMiddleware:
    """ASGI middleware that intercepts WebSocket connections at ``/slop``
    and ``GET /.well-known/slop`` for discovery.

    All other requests are passed through to the wrapped app.
    """

    def __init__(
        self,
        app: ASGIApp,
        slop: SlopServer,
        *,
        path: str = "/slop",
        discovery: bool = True,
    ) -> None:
        self.app = app
        self.slop = slop
        self.path = path
        self.discovery = discovery

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket" and scope.get("path") == self.path:
            await self._handle_websocket(scope, receive, send)
        elif (
            self.discovery
            and scope["type"] == "http"
            and scope.get("path") == "/.well-known/slop"
            and scope.get("method", "GET") == "GET"
        ):
            await self._handle_discovery(scope, receive, send)
        else:
            await self.app(scope, receive, send)

    async def _handle_websocket(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Accept the WebSocket
        event = await receive()
        if event["type"] != "websocket.connect":
            return
        await send({"type": "websocket.accept"})

        conn = _WebSocketConnection(send)
        self.slop.handle_connection(conn)

        try:
            while True:
                event = await receive()
                if event["type"] == "websocket.receive":
                    text = event.get("text", "")
                    if text:
                        try:
                            msg = json.loads(text)
                            await self.slop.handle_message(conn, msg)
                        except json.JSONDecodeError:
                            pass
                elif event["type"] == "websocket.disconnect":
                    break
        finally:
            self.slop.handle_disconnect(conn)

    async def _handle_discovery(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Read request body (required by ASGI)
        while True:
            event = await receive()
            if event["type"] == "http.request":
                break

        host = "localhost"
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"host":
                host = header_value.decode()
                break

        body = json.dumps({
            "id": self.slop.id,
            "name": self.slop.name,
            "slop_version": "0.1",
            "transport": {"type": "ws", "url": f"ws://{host}{self.path}"},
            "capabilities": ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
        }).encode()

        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                [b"content-type", b"application/json"],
                [b"content-length", str(len(body)).encode()],
            ],
        })
        await send({
            "type": "http.response.body",
            "body": body,
        })


def asgi_app(
    slop: SlopServer,
    *,
    path: str = "/slop",
    discovery: bool = True,
) -> ASGIApp:
    """Return a standalone ASGI application for SLOP.

    Can be mounted on another ASGI app::

        app.mount("/", asgi_app(slop))
    """
    async def _not_found(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            while True:
                event = await receive()
                if event["type"] == "http.request":
                    break
            await send({
                "type": "http.response.start",
                "status": 404,
                "headers": [[b"content-type", b"text/plain"]],
            })
            await send({"type": "http.response.body", "body": b"Not Found"})

    return SlopMiddleware(_not_found, slop, path=path, discovery=discovery)
