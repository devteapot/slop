# slop-ai

Python SDK for the [SLOP protocol](https://slopai.dev) (State Layer for Observable Programs) — let AI observe and interact with your app's state.

## Install

```bash
pip install slop-ai[websocket]
```

## Quick start (FastAPI)

```python
from fastapi import FastAPI
from slop import SlopServer
from slop.transports.asgi import SlopMiddleware

app = FastAPI()
slop = SlopServer("my-api", "My API")

@slop.node("todos")
def todos_node():
    return {
        "type": "collection",
        "items": [
            {"id": str(t.id), "props": {"title": t.title, "done": t.done}}
            for t in db.get_todos()
        ],
    }

@slop.action("todos", "create", params={"title": "string"})
def create_todo(title: str):
    db.create_todo(title)

app.add_middleware(SlopMiddleware, slop=slop)
```

## Transports

```python
# WebSocket (standalone)
from slop.transports.websocket import serve
server = await serve(slop, host="0.0.0.0", port=8765)

# Unix socket
from slop.transports.unix import listen
server = await listen(slop, "/tmp/slop/my-app.sock", register=True)

# Stdio (CLI tools)
from slop.transports.stdio import listen as listen_stdio
await listen_stdio(slop)

# ASGI middleware (FastAPI/Starlette)
from slop.transports.asgi import SlopMiddleware
app.add_middleware(SlopMiddleware, slop=slop)
```

## Links

- [SLOP Protocol](https://slopai.dev)
- [Python guide](https://slopai.dev/guides/python)
- [GitHub](https://github.com/slop-ai/slop)
