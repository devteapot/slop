"""WebSocket transport for SLOP using the ``websockets`` library.

Usage::

    from slop import SlopServer
    from slop.transports.websocket import serve

    slop = SlopServer("my-app", "My App")

    async def main():
        server = await serve(slop, host="0.0.0.0", port=8765)
        await server.wait_closed()
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

try:
    import websockets
    from websockets.asyncio.server import Server, ServerConnection, serve as ws_serve
except ImportError as e:
    raise ImportError(
        "websockets is required for the WebSocket transport. "
        "Install it with: pip install slop-ai[websocket]"
    ) from e

from slop.server import SlopServer


class _WsConnection:
    """Wraps a websockets connection as a SLOP Connection."""

    __slots__ = ("_ws",)

    def __init__(self, ws: ServerConnection) -> None:
        self._ws = ws

    def send(self, message: dict[str, Any]) -> None:
        asyncio.ensure_future(self._ws.send(json.dumps(message)))

    def close(self) -> None:
        asyncio.ensure_future(self._ws.close())


async def serve(
    slop: SlopServer,
    host: str = "localhost",
    port: int = 8765,
    path: str = "/slop",
) -> Server:
    """Start a standalone SLOP WebSocket server.

    Returns a ``websockets.Server`` — call ``await server.wait_closed()``
    to block until shutdown.
    """

    async def handler(ws: ServerConnection) -> None:
        # Check path
        if ws.request and ws.request.path != path:
            await ws.close(4004, f"Not found: {ws.request.path}")
            return

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

    server = await ws_serve(handler, host, port)
    return server
