---
title: "slop-ai (Python)"
description: Python package reference for SLOP providers, consumers, and transports
---

```bash
pip install slop-ai[websocket]
```

## Main imports

```python
from slop_ai import SlopServer, SlopConsumer, pick, omit
from slop_ai.transports.asgi import SlopMiddleware
```

## Included modules

- provider APIs via `SlopServer`
- consumer APIs via `SlopConsumer`
- transport modules for ASGI, WebSocket, Unix socket, stdio, and matching client transports
- scaling helpers such as `prepare_tree()` and `truncate_tree()`
- LLM tool helpers such as `affordances_to_tools()` and `format_tree()`

## Best fit

- FastAPI and Starlette services
- Python desktop and daemon processes
- CLI tools that need Unix or stdio transports
- Python-based agent consumers

## Related pages

- [Python guide](/guides/python)
- [Consumer guide](/guides/consumer)
