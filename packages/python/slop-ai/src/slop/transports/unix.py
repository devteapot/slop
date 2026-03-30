"""Unix domain socket transport using NDJSON (newline-delimited JSON).

Usage::

    from slop import SlopServer
    from slop.transports.unix import listen

    slop = SlopServer("my-app", "My App")

    async def main():
        server = await listen(slop, "/tmp/slop/my-app.sock", register=True)
        # server runs until cancelled
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from slop.server import SlopServer


class _NdjsonConnection:
    """Wraps an asyncio StreamWriter as a SLOP Connection."""

    __slots__ = ("_writer",)

    def __init__(self, writer: asyncio.StreamWriter) -> None:
        self._writer = writer

    def send(self, message: dict[str, Any]) -> None:
        try:
            line = json.dumps(message) + "\n"
            self._writer.write(line.encode())
        except Exception:
            pass

    def close(self) -> None:
        try:
            self._writer.close()
        except Exception:
            pass


async def listen(
    slop: SlopServer,
    socket_path: str,
    *,
    register: bool = False,
) -> asyncio.Server:
    """Listen for SLOP consumers on a Unix domain socket.

    Uses NDJSON (one JSON message per line) as the wire format.

    Args:
        slop: The server instance.
        socket_path: Filesystem path for the socket.
        register: If True, create a discovery descriptor in ``~/.slop/providers/``.

    Returns:
        An ``asyncio.Server``. Cancel it or call ``server.close()`` to stop.
    """
    # Clean up stale socket
    try:
        os.unlink(socket_path)
    except FileNotFoundError:
        pass
    Path(socket_path).parent.mkdir(parents=True, exist_ok=True)

    async def client_handler(
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        conn = _NdjsonConnection(writer)
        slop.handle_connection(conn)

        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                text = line.decode().strip()
                if not text:
                    continue
                try:
                    msg = json.loads(text)
                    await slop.handle_message(conn, msg)
                except json.JSONDecodeError:
                    pass
        finally:
            slop.handle_disconnect(conn)
            writer.close()

    server = await asyncio.start_unix_server(client_handler, path=socket_path)

    # Set restrictive permissions
    os.chmod(socket_path, 0o600)

    if register:
        _register_provider(slop.id, slop.name, socket_path)

    return server


def _register_provider(id: str, name: str, socket_path: str) -> None:
    """Write a discovery descriptor to ``~/.slop/providers/``."""
    providers_dir = Path.home() / ".slop" / "providers"
    providers_dir.mkdir(parents=True, exist_ok=True)
    descriptor = {
        "id": id,
        "name": name,
        "slop_version": "0.1",
        "transport": {"type": "unix", "path": socket_path},
        "pid": os.getpid(),
        "capabilities": ["state", "patches", "affordances"],
    }
    (providers_dir / f"{id}.json").write_text(json.dumps(descriptor, indent=2))


def unregister_provider(id: str) -> None:
    """Remove a discovery descriptor from ``~/.slop/providers/``."""
    path = Path.home() / ".slop" / "providers" / f"{id}.json"
    try:
        path.unlink()
    except FileNotFoundError:
        pass
