# `slop-ai`

Python SDK for the [SLOP protocol](https://slopai.dev).

The package includes provider and consumer APIs, descriptor helpers, tree scaling utilities, and transports for ASGI, WebSocket, Unix socket, and stdio flows.

## Install

```bash
pip install slop-ai[websocket]
```

Use the `websocket` extra when you want the standalone WebSocket transport. The core package itself has no required runtime dependencies.

## Quick start

```python
from fastapi import FastAPI
from slop_ai import SlopServer
from slop_ai.transports.asgi import SlopMiddleware

app = FastAPI()
slop = SlopServer("my-api", "My API")

@slop.node("todos")
def todos_node():
    return {
        "type": "collection",
        "items": [
            {"id": str(todo.id), "props": {"title": todo.title, "done": todo.done}}
            for todo in db.get_todos()
        ],
    }

@slop.action("todos", "create", params={"title": "string"})
def create_todo(title: str):
    db.create_todo(title)

app.add_middleware(SlopMiddleware, slop=slop)
```

## Included modules

- `slop_ai.SlopServer` and `slop_ai.SlopConsumer`
- `slop_ai.pick`, `slop_ai.omit`, `slop_ai.normalize_descriptor`
- `slop_ai.transports.asgi`, `.websocket`, `.unix`, `.stdio`
- scaling helpers such as `prepare_tree`, `truncate_tree`, and `auto_compact`

## Documentation

- API reference: https://docs.slopai.dev/api/python
- Python guide: https://docs.slopai.dev/guides/python
- Protocol spec: https://docs.slopai.dev/spec/core/overview
