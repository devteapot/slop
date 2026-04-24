"""WebSocket transport for SLOP using the ``websockets`` library.

Usage::

    from slop_ai import SlopServer
    from slop_ai.transports.websocket import serve

    slop = SlopServer("my-app", "My App")

    async def main():
        server = await serve(slop, host="0.0.0.0", port=8765)
        await server.wait_closed()
"""

from __future__ import annotations

import asyncio
import inspect
import ipaddress
import json
import logging
from typing import Any, Awaitable, Callable, Iterable

try:
    import websockets
    from websockets.asyncio.server import Server, ServerConnection, serve as ws_serve
    from websockets.datastructures import Headers
    from websockets.http11 import Request, Response
except ImportError as e:
    raise ImportError(
        "websockets is required for the WebSocket transport. "
        "Install it with: pip install slop-ai[websocket]"
    ) from e

from slop_ai.server import SlopServer

_log = logging.getLogger(__name__)

# Authenticate hook: receives the incoming Request and returns True to accept.
# May be sync or async; raising is treated the same as returning False.
Authenticator = Callable[[Any], "bool | Awaitable[bool]"]


def _is_loopback_remote(ws: ServerConnection) -> bool:
    peer = getattr(ws, "remote_address", None)
    if not peer:
        return False
    host = peer[0] if isinstance(peer, tuple) else str(peer)
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host in ("localhost", "::1")


def _reject(status: int, reason: str) -> Response:
    body = reason.encode() + b"\n"
    headers = Headers([("Content-Length", str(len(body))), ("Content-Type", "text/plain; charset=utf-8")])
    return Response(status, reason, headers, body)


async def serve(
    slop: SlopServer,
    host: str = "localhost",
    port: int = 8765,
    path: str = "/slop",
    *,
    authenticate: Authenticator | None = None,
    allowed_origins: Iterable[str] | None = None,
) -> Server:
    """Start a standalone SLOP WebSocket server.

    Per spec/core/transport.md §Security considerations, non-loopback upgrades
    without an ``authenticate`` hook are rejected with 401. Set
    ``authenticate=lambda req: True`` to opt out explicitly (not recommended).

    Returns a ``websockets.Server`` — call ``await server.wait_closed()``
    to block until shutdown.
    """

    origins_set = set(allowed_origins) if allowed_origins is not None else None

    async def process_request(ws: ServerConnection, request: Request) -> Response | None:
        # Reject during the HTTP upgrade — before the WebSocket is accepted —
        # per spec/core/transport.md §Security considerations.
        request_path = request.path.split("?", 1)[0]
        if request_path != path:
            return _reject(404, "Not Found")

        origin = request.headers.get("Origin")
        if origin is not None:
            if origins_set is None:
                _log.warning(
                    "[slop] refusing browser WebSocket upgrade: no allowed_origins configured. "
                    "See spec/core/transport.md §Security considerations."
                )
                return _reject(403, "Forbidden")
            if origin not in origins_set:
                return _reject(403, "Forbidden")

        if authenticate is not None:
            try:
                result = authenticate(request)
                if inspect.isawaitable(result):
                    result = await result
                if not result:
                    return _reject(401, "Unauthorized")
            except Exception:
                return _reject(401, "Unauthorized")
        elif not _is_loopback_remote(ws):
            _log.warning(
                "[slop] refusing non-loopback WebSocket upgrade: no authenticate hook configured. "
                "See spec/core/transport.md §Security considerations."
            )
            return _reject(401, "Unauthorized")

        return None

    async def handler(ws: ServerConnection) -> None:
        conn = _WsConnection(ws)
        slop.handle_connection(conn)

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    await slop.handle_message(conn, msg)
                except json.JSONDecodeError:
                    pass
        finally:
            slop.handle_disconnect(conn)

    server = await ws_serve(handler, host, port, process_request=process_request)
    return server


class _WsConnection:
    """Wraps a websockets connection as a SLOP Connection."""

    __slots__ = ("_ws",)

    def __init__(self, ws: ServerConnection) -> None:
        self._ws = ws

    def send(self, message: dict[str, Any]) -> None:
        asyncio.ensure_future(self._ws.send(json.dumps(message)))

    def close(self) -> None:
        asyncio.ensure_future(self._ws.close())
