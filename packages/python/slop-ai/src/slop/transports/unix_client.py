"""Unix domain socket client transport for SlopConsumer."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable


class UnixClientConnection:
    """Client connection over Unix domain socket (NDJSON framing)."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._message_handler: Callable[[dict[str, Any]], None] | None = None
        self._close_handler: Callable[[], None] | None = None
        self._reader_task: asyncio.Task[None] | None = None

    async def send(self, message: dict[str, Any]) -> None:
        data = json.dumps(message) + "\n"
        self._writer.write(data.encode())
        await self._writer.drain()

    def on_message(self, handler: Callable[[dict[str, Any]], None]) -> None:
        self._message_handler = handler

    def on_close(self, handler: Callable[[], None]) -> None:
        self._close_handler = handler

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
        self._writer.close()
        await self._writer.wait_closed()

    def _start_reader(self) -> None:
        self._reader_task = asyncio.get_running_loop().create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            while True:
                line = await self._reader.readline()
                if not line:
                    break
                if self._message_handler is not None:
                    msg: dict[str, Any] = json.loads(line)
                    self._message_handler(msg)
        except asyncio.CancelledError:
            return
        except Exception:
            pass
        finally:
            if self._close_handler is not None:
                self._close_handler()


class UnixClientTransport:
    """Client transport that connects to a Unix domain socket."""

    def __init__(self, path: str) -> None:
        self._path = path

    async def connect(self) -> UnixClientConnection:
        reader, writer = await asyncio.open_unix_connection(self._path)
        conn = UnixClientConnection(reader, writer)
        conn._start_reader()
        return conn
