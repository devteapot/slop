"""ASGI transport for SLOP — integrates with FastAPI, Starlette, and other ASGI frameworks.

Usage with FastAPI::

    from fastapi import FastAPI
    from slop_ai import SlopServer
    from slop_ai.transports.asgi import SlopMiddleware

    app = FastAPI()
    slop = SlopServer("my-api", "My API")

    app.add_middleware(SlopMiddleware, slop=slop)

Or mount as a standalone ASGI app::

    from slop_ai.transports.asgi import asgi_app
    app.mount("/", asgi_app(slop))
"""

from __future__ import annotations

import asyncio
import inspect
import ipaddress
import json
import logging
from typing import Any, Awaitable, Callable, Iterable

from slop_ai.server import SlopServer

_log = logging.getLogger(__name__)

# ASGI type aliases
Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

# Authenticate hook: receives the ASGI scope and returns True to accept.
# May be sync or async; raising is treated the same as returning False.
Authenticator = Callable[[Scope], "bool | Awaitable[bool]"]


def _scope_is_loopback(scope: Scope) -> bool:
    client = scope.get("client")
    if not client:
        return False
    host = client[0] if isinstance(client, (list, tuple)) else str(client)
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host in ("localhost", "::1")


def _scope_origin(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == b"origin":
            return value.decode()
    return None


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
        authenticate: Authenticator | None = None,
        allowed_origins: Iterable[str] | None = None,
    ) -> None:
        self.app = app
        self.slop = slop
        self.path = path
        self.discovery = discovery
        self.authenticate = authenticate
        self.allowed_origins = set(allowed_origins) if allowed_origins is not None else None

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

        # Origin allowlist (only applies when client sent Origin).
        origin = _scope_origin(scope)
        if origin is not None and self.allowed_origins is not None and origin not in self.allowed_origins:
            await send({"type": "websocket.close", "code": 4003})
            return

        # Authentication. Default-deny non-loopback when no hook is configured.
        if self.authenticate is not None:
            try:
                result = self.authenticate(scope)
                if inspect.isawaitable(result):
                    result = await result
                if not result:
                    await send({"type": "websocket.close", "code": 4401})
                    return
            except Exception:
                await send({"type": "websocket.close", "code": 4401})
                return
        elif not _scope_is_loopback(scope):
            _log.warning(
                "[slop] refusing non-loopback WebSocket upgrade: no authenticate hook configured. "
                "See spec/core/transport.md §Security considerations."
            )
            await send({"type": "websocket.close", "code": 4401})
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
    authenticate: Authenticator | None = None,
    allowed_origins: Iterable[str] | None = None,
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

    return SlopMiddleware(
        _not_found,
        slop,
        path=path,
        discovery=discovery,
        authenticate=authenticate,
        allowed_origins=allowed_origins,
    )
