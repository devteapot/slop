"""WebSocket client transport for SlopConsumer."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

try:
    import websockets
except ImportError:
    websockets = None  # type: ignore[assignment]


class WebSocketClientConnection:
    """Client connection over WebSocket."""

    def __init__(self, ws: Any) -> None:
        self._ws = ws
        self._message_handler: Callable[[dict[str, Any]], None] | None = None
        self._close_handler: Callable[[], None] | None = None
        self._reader_task: asyncio.Task[None] | None = None

    async def send(self, message: dict[str, Any]) -> None:
        await self._ws.send(json.dumps(message))

    def on_message(self, handler: Callable[[dict[str, Any]], None]) -> None:
        self._message_handler = handler

    def on_close(self, handler: Callable[[], None]) -> None:
        self._close_handler = handler

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
        await self._ws.close()

    def _start_reader(self) -> None:
        self._reader_task = asyncio.get_running_loop().create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                if self._message_handler is not None:
                    msg: dict[str, Any] = json.loads(raw)
                    self._message_handler(msg)
        except asyncio.CancelledError:
            return
        except Exception:
            pass
        finally:
            if self._close_handler is not None:
                self._close_handler()


class WebSocketClientTransport:
    """Client transport that connects to a WebSocket URL."""

    def __init__(self, url: str) -> None:
        if websockets is None:
            raise ImportError("Install websockets: pip install slop-ai[websockets]")
        self._url = url

    async def connect(self) -> WebSocketClientConnection:
        ws = await websockets.connect(self._url)
        conn = WebSocketClientConnection(ws)
        conn._start_reader()
        return conn
