"""Stdio transport using NDJSON on stdin/stdout.

Best for CLI tools and spawned subprocesses. Supports a single consumer.

Usage::

    from slop import SlopServer
    from slop.transports.stdio import listen

    slop = SlopServer("my-tool", "My Tool")
    # ... register nodes ...

    import asyncio
    asyncio.run(listen(slop))
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from slop.server import SlopServer


class _StdioConnection:
    """Wraps stdout as a SLOP Connection."""

    def send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message) + "\n"
        sys.stdout.write(line)
        sys.stdout.flush()

    def close(self) -> None:
        pass  # Can't close stdout


async def listen(slop: SlopServer) -> None:
    """Listen on stdin/stdout with NDJSON. Blocks until stdin is closed.

    This is the simplest transport — suitable for CLI tools that
    communicate via pipes.
    """
    conn = _StdioConnection()
    slop.handle_connection(conn)

    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

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
