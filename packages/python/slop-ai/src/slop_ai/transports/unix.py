"""Unix domain socket transport using NDJSON (newline-delimited JSON).

Usage::

    from slop_ai import SlopServer
    from slop_ai.transports.unix import listen

    slop = SlopServer("my-app", "My App")

    async def main():
        server = await listen(slop, "/tmp/slop/my-app.sock", register=True)
        # server runs until cancelled
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from slop_ai.server import SlopServer

logger = logging.getLogger("slop")

# See spec/core/transport.md §Local discovery.
_DESCRIPTOR_FILENAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


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
            logger.debug("failed to send message over unix socket", exc_info=True)

    def close(self) -> None:
        try:
            self._writer.close()
        except Exception:
            logger.debug("error closing unix socket connection", exc_info=True)


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
    """Write a discovery descriptor to ``~/.slop/providers/``.

    The providers directory is created with mode 0700 and the descriptor is
    written atomically (write to a same-directory temp file, then rename) with
    mode 0600. See spec/core/transport.md §Local discovery.
    """
    if not _DESCRIPTOR_FILENAME_RE.match(id):
        raise ValueError(
            f"provider id {id!r} is not a valid descriptor filename stem "
            f"(must match {_DESCRIPTOR_FILENAME_RE.pattern})"
        )
    providers_dir = Path.home() / ".slop" / "providers"
    providers_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(providers_dir, 0o700)
    descriptor = {
        "id": id,
        "name": name,
        "slop_version": "0.1",
        "transport": {"type": "unix", "path": socket_path},
        "pid": os.getpid(),
        "capabilities": ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
    }
    data = json.dumps(descriptor, indent=2)
    final_path = providers_dir / f"{id}.json"
    tmp_path = providers_dir / f"{id}.json.tmp.{os.getpid()}"
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(data)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, final_path)
    except Exception:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise


def unregister_provider(id: str) -> None:
    """Remove a discovery descriptor from ``~/.slop/providers/``."""
    if not _DESCRIPTOR_FILENAME_RE.match(id):
        return
    path = Path.home() / ".slop" / "providers" / f"{id}.json"
    try:
        path.unlink()
    except FileNotFoundError:
        pass
