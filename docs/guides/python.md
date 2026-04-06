# Python

## Install

```bash
pip install slop-ai[websocket]
```

The `websocket` extra adds the standalone WebSocket transport. The core package itself has no required runtime dependencies.

## FastAPI / Starlette

```python
from fastapi import FastAPI
from slop_ai import SlopServer
from slop_ai.transports.asgi import SlopMiddleware

app = FastAPI()
slop = SlopServer("my-api", "My API")

@slop.node("todos")
def todos_node():
    todos = db.get_todos()
    return {
        "type": "collection",
        "props": {"count": len(todos)},
        "items": [
            {
                "id": str(todo.id),
                "props": {"title": todo.title, "done": todo.done},
            }
            for todo in todos
        ],
    }

@slop.action("todos", "create", params={"title": "string"})
def create_todo(title: str):
    db.create_todo(title)

app.add_middleware(SlopMiddleware, slop=slop)
```

Call `slop.refresh()` after mutations that happen outside SLOP action handlers.

## Standalone WebSocket server

```python
import asyncio
from slop_ai import SlopServer
from slop_ai.transports.websocket import serve

slop = SlopServer("my-app", "My App")

async def main():
    server = await serve(slop, host="0.0.0.0", port=8765)
    await server.wait_closed()

asyncio.run(main())
```

## Unix socket and stdio

Use the Unix transport for local desktop apps, daemons, or CLI tools that should register with `~/.slop/providers/`:

```python
from slop_ai.transports.unix import listen

server = await listen(slop, "/tmp/slop/my-app.sock", register=True)
```

Use stdio when the SLOP connection should run over a subprocess pipe:

```python
from slop_ai.transports.stdio import listen

await listen(slop)
```

## Consumer example

```python
import asyncio
from slop_ai import SlopConsumer
from slop_ai.transports.ws_client import WebSocketClientTransport

async def main():
    consumer = SlopConsumer(WebSocketClientTransport("ws://localhost:8765/slop"))
    hello = await consumer.connect()
    sub_id, snapshot = await consumer.subscribe("/", depth=-1)
    await consumer.invoke("/todos", "create", {"title": "Ship docs"})
    print(hello["provider"]["name"], sub_id, snapshot["id"])

asyncio.run(main())
```

Unix consumer connections are available via `slop_ai.transports.unix_client.UnixClientTransport`.

## Discovery layer

The Python SDK also includes the core discovery layer in `slop_ai.discovery`:

```python
import asyncio

from slop_ai.discovery import DiscoveryOptions, create_discovery_service


async def main() -> None:
    service = create_discovery_service(DiscoveryOptions())
    await service.start()
    try:
        provider = await service.ensure_connected("my-app")
        if provider is not None:
            print(provider.name)
    finally:
        await service.stop()


asyncio.run(main())
```

Install `slop-ai[websocket]` when discovery needs browser bridge support or direct WebSocket providers.

## Utilities

The package also exports:

- `pick()` and `omit()` for descriptor shaping
- `prepare_tree()`, `truncate_tree()`, and `auto_compact()` for scaling
- `affordances_to_tools()` and `format_tree()` for LLM integrations

## Next Steps

- [Python package API](/api/python)
- [Consumer guide](/guides/consumer)
- [Server and native apps guide](/guides/server-apps)
