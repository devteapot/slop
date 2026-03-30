---
title: Python
description: Add SLOP to Python apps — FastAPI, CLI tools, desktop apps
---

## Install

```bash
pip install slop-ai[websocket]
```

Zero required dependencies. The `[websocket]` extra installs `websockets` for the WebSocket transport — omit it if you only need Unix socket, stdio, or ASGI transports.

## FastAPI / Starlette (ASGI)

```python
from fastapi import FastAPI
from slop import SlopServer
from slop.transports.asgi import SlopMiddleware

app = FastAPI()
slop = SlopServer("my-api", "My API")

# Static registration — descriptor dict
slop.register("status", {"type": "status", "props": {"healthy": True}})

# Dynamic registration — re-evaluated on every refresh()
@slop.node("todos")
def todos_node():
    todos = db.get_todos()
    return {
        "type": "collection",
        "props": {"count": len(todos)},
        "items": [
            {
                "id": str(t.id),
                "props": {"title": t.title, "done": t.done},
                "actions": {
                    "toggle": lambda t=t: db.toggle(t.id),
                    "delete": {"handler": lambda t=t: db.delete(t.id), "dangerous": True},
                },
            }
            for t in todos
        ],
    }

# Actions via decorator — params are unpacked as keyword args
@slop.action("todos", "create", params={"title": "string"})
def create_todo(title: str):
    db.create_todo(title)

# ASGI middleware: WebSocket at /slop + discovery at /.well-known/slop
app.add_middleware(SlopMiddleware, slop=slop)
```

After a mutation outside of SLOP (e.g., a REST endpoint), call `slop.refresh()` to re-evaluate all `@slop.node` functions and broadcast patches:

```python
@app.post("/api/todos")
def create_todo_api(title: str):
    db.create_todo(title)
    slop.refresh()
    return {"ok": True}
```

## WebSocket (standalone)

```python
import asyncio
from slop import SlopServer
from slop.transports.websocket import serve

slop = SlopServer("my-app", "My App")
# ... register nodes ...

async def main():
    server = await serve(slop, host="0.0.0.0", port=8765)
    await server.wait_closed()

asyncio.run(main())
```

## Unix socket

Best for desktop apps (tkinter, PyQt), background daemons, and local CLI tools.

```python
import asyncio
from slop import SlopServer
from slop.transports.unix import listen

slop = SlopServer("my-daemon", "My Daemon")
# ... register nodes ...

async def main():
    server = await listen(slop, "/tmp/slop/my-daemon.sock", register=True)
    await asyncio.Event().wait()  # run forever

asyncio.run(main())
```

When `register=True`, the provider writes a discovery descriptor to `~/.slop/providers/my-daemon.json` so the SLOP desktop app and other consumers can find it automatically.

## Stdio (CLI tools)

```python
import asyncio
from slop import SlopServer
from slop.transports.stdio import listen

slop = SlopServer("my-cli", "My CLI Tool")
slop.register("status", {"type": "status", "props": {"running": True}})

asyncio.run(listen(slop))
```

The consumer communicates via stdin/stdout using NDJSON (one JSON message per line).

## Descriptors

Descriptors are plain dicts — no need to import classes:

```python
# Node types: root, view, collection, item, document, form, field,
#             control, status, notification, media, group, context

{
    "type": "collection",
    "props": {"count": 42, "label": "Messages"},
    "summary": "42 messages, 5 unread",
    "items": [
        {
            "id": "msg-1",
            "props": {"from": "alice", "subject": "Hello", "unread": True},
            "actions": {
                "open": lambda: open_message("msg-1"),
                "archive": lambda: archive("msg-1"),
                "delete": {"handler": lambda: delete("msg-1"), "dangerous": True},
            },
        },
    ],
    "actions": {
        "compose": {
            "handler": lambda subject, body: send(subject, body),
            "params": {"subject": "string", "body": "string"},
            "label": "Compose",
        },
    },
    "meta": {"salience": 0.8, "urgency": "medium"},
}
```

### Content references

For large content (files, streams), use `content_ref` to avoid inlining in the tree:

```python
slop.register("editor/main-py", {
    "type": "document",
    "props": {"title": "main.py", "language": "python"},
    "content_ref": {
        "type": "text",
        "mime": "text/python",
        "summary": "FastAPI app, 200 lines, defines 5 routes",
        "preview": "from fastapi import FastAPI\n...",
    },
    "actions": {
        "read_content": lambda: {"content": open("main.py").read()},
    },
})
```

## Scoped registration

Use `scope()` to namespace registrations. Also works as a context manager:

```python
# Persistent scope
settings = slop.scope("settings")
settings.register("account", {"type": "group", "props": {"email": "a@b.com"}})
settings.register("theme", {"type": "group", "props": {"dark": True}})
# Registers at "settings/account" and "settings/theme"

# Context manager — auto-unregisters on exit
with slop.scope("wizard") as wiz:
    wiz.register("step1", {"type": "form", "props": {"complete": False}})
    # ... do work ...
# "wizard/step1" and "wizard" are unregistered here
```

## Multiple transports

A server can expose multiple transports sharing the same state:

```python
import asyncio
from slop.transports.websocket import serve
from slop.transports.unix import listen

async def main():
    ws_server = await serve(slop, port=8765)           # remote consumers
    unix_server = await listen(slop, "/tmp/slop/app.sock")  # local agents
    await asyncio.Event().wait()

asyncio.run(main())
```

## Consumer

Connect to a SLOP provider, subscribe to state, and invoke actions:

```python
import asyncio
from slop import SlopConsumer
from slop.transports.ws_client import WebSocketClientTransport

async def main():
    transport = WebSocketClientTransport("ws://localhost:8765")
    consumer = SlopConsumer(transport)

    hello = await consumer.connect()
    print(f"Connected to {hello['provider']['name']}")

    sub_id, snapshot = await consumer.subscribe("/", depth=-1)
    print(f"Got tree with {len(snapshot.children or [])} children")

    # Invoke an action
    result = await consumer.invoke("/todos", "create", {"title": "New task"})
    print(f"Created: {result}")

    # Listen for patches
    consumer.on_patch(lambda sub, ops, ver: print(f"Patch v{ver}: {len(ops)} ops"))

    # Query a subtree
    node = await consumer.query("/todos", depth=1)

    consumer.disconnect()

asyncio.run(main())
```

Transports: `WebSocketClientTransport` and `UnixClientTransport` (from `slop.transports.unix_client`).

## Scaling

Prepare trees for output with depth truncation, salience filtering, and node-budget compaction:

```python
from slop import prepare_tree, truncate_tree, filter_tree, auto_compact, OutputTreeOptions

# Apply all scaling in one call
prepared = prepare_tree(tree, OutputTreeOptions(
    max_depth=2,
    min_salience=0.3,
    max_nodes=50,
))

# Or apply individually
shallow = truncate_tree(tree, depth=2)       # collapse beyond depth 2
relevant = filter_tree(tree, min_salience=0.5)  # drop low-salience nodes
compact = auto_compact(tree, max_nodes=50)    # collapse lowest-salience subtrees
```

## LLM tools

Convert a SLOP tree into LLM-compatible tool definitions:

```python
from slop import affordances_to_tools, format_tree, encode_tool, decode_tool

# Convert tree affordances to OpenAI-style tool list
tools = affordances_to_tools(tree)
# [{"type": "function", "function": {"name": "invoke__todos__create", ...}}]

# Format tree as readable text for LLM context
context = format_tree(tree)
# [collection] Inbox (count=42, unread=5)  actions: {compose(subject, body)}
#   [item] msg-1 (from="alice", subject="Hello")  actions: {open, archive}

# Encode/decode tool names
name = encode_tool("/todos", "create")   # "invoke__todos__create"
path, action = decode_tool(name).values() # "/todos", "create"
```
