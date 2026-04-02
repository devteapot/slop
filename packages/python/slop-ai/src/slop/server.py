"""Server-side SLOP provider with multi-connection support.

``SlopServer`` supports descriptor functions (re-evaluated on ``refresh()``),
multiple simultaneous consumer connections, and decorator-based registration.

Usage::

    from slop import SlopServer

    slop = SlopServer("my-api", "My API")

    @slop.node("todos")
    def todos_node():
        return {
            "type": "collection",
            "props": {"count": len(todos)},
            "items": [{"id": t.id, "props": {"title": t.title}} for t in todos],
        }

    @slop.action("todos", "create", params={"title": "string"})
    def create_todo(title: str):
        todos.append(Todo(title=title))

    slop.refresh()
"""

from __future__ import annotations

import copy
import inspect
from typing import Any, Callable, Protocol, runtime_checkable

from .types import SlopNode, NodeMeta, PatchOp
from .tree import assemble_tree
from .diff import diff_nodes
from .scaling import prepare_tree, get_subtree, OutputTreeOptions


@runtime_checkable
class Connection(Protocol):
    """A connected consumer."""

    def send(self, message: dict[str, Any]) -> None: ...
    def close(self) -> None: ...


class SlopServer:
    """Server-side SLOP provider.

    Manages registrations, connections, subscriptions, and message routing.
    """

    def __init__(
        self,
        id: str,
        name: str,
        *,
        schema: dict[str, Any] | None = None,
    ) -> None:
        self.id = id
        self.name = name
        self._schema = schema
        self._dynamic: dict[str, Callable[[], dict[str, Any]]] = {}
        self._static: dict[str, dict[str, Any]] = {}
        self._decorator_actions: dict[str, dict[str, Any]] = {}
        self._current_tree = SlopNode(id=id, type="root")
        self._current_handlers: dict[str, Callable[..., Any]] = {}
        self._version = 0
        self._subscriptions: list[_Subscription] = []
        self._connections: set[Connection] = set()
        self._change_listeners: list[Callable[[], None]] = []

    # --- Properties ---

    @property
    def tree(self) -> SlopNode:
        """Current state tree."""
        return self._current_tree

    @property
    def version(self) -> int:
        """Current version number."""
        return self._version

    # --- Registration ---

    def register(self, path: str, descriptor: dict[str, Any]) -> None:
        """Register a static node descriptor at *path*."""
        merged = self._merge_decorator_actions(path, descriptor)
        self._static[path] = merged
        self._dynamic.pop(path, None)
        self._rebuild()

    def node(self, path: str) -> Callable:
        """Decorator: register a descriptor function re-evaluated on ``refresh()``.

        ::

            @slop.node("todos")
            def todos_node():
                return {"type": "collection", "items": [...]}
        """
        def decorator(fn: Callable[[], dict[str, Any]]) -> Callable[[], dict[str, Any]]:
            self._dynamic[path] = fn
            self._static.pop(path, None)
            self._rebuild()
            return fn
        return decorator

    def action(
        self,
        path: str,
        name: str,
        *,
        params: dict[str, Any] | None = None,
        label: str | None = None,
        description: str | None = None,
        dangerous: bool = False,
        idempotent: bool = False,
        estimate: str | None = None,
    ) -> Callable:
        """Decorator to register an action handler at *path*.

        The decorated function receives keyword args matching the action params::

            @slop.action("todos", "create", params={"title": "string"})
            def create_todo(title: str):
                ...
        """
        def decorator(fn: Callable) -> Callable:
            action_def: dict[str, Any] = {"handler": _wrap_handler(fn)}
            if params:
                action_def["params"] = params
            if label:
                action_def["label"] = label
            if description:
                action_def["description"] = description
            if dangerous:
                action_def["dangerous"] = True
            if idempotent:
                action_def["idempotent"] = True
            if estimate:
                action_def["estimate"] = estimate

            actions = self._decorator_actions.setdefault(path, {})
            actions[name] = action_def

            # Re-merge if path already registered statically
            if path in self._static:
                self._static[path] = self._merge_decorator_actions(path, self._static[path])
                self._rebuild()

            return fn
        return decorator

    def unregister(self, path: str, *, recursive: bool = False) -> None:
        """Remove the registration at *path*.

        If *recursive* is True, also remove all registrations under *path*.
        """
        if recursive:
            prefix = path + "/"
            for store in (self._dynamic, self._static):
                to_remove = [k for k in store if k == path or k.startswith(prefix)]
                for k in to_remove:
                    del store[k]
        else:
            self._dynamic.pop(path, None)
            self._static.pop(path, None)
        self._rebuild()

    def scope(self, prefix: str) -> _ScopedServer:
        """Return a scoped server that prefixes all paths."""
        return _ScopedServer(self, prefix)

    def refresh(self) -> None:
        """Re-evaluate all ``@node`` functions, diff, and broadcast patches."""
        self._rebuild()

    # --- Connection lifecycle (used by transports) ---

    def handle_connection(self, conn: Connection) -> None:
        """Called by a transport when a new consumer connects."""
        self._connections.add(conn)
        conn.send({
            "type": "hello",
            "provider": {
                "id": self.id,
                "name": self.name,
                "slop_version": "0.1",
                "capabilities": ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
            },
        })

    def emit_event(self, name: str, data: Any = None) -> None:
        """Send an event message to all connected consumers."""
        msg: dict[str, Any] = {"type": "event", "name": name}
        if data is not None:
            msg["data"] = data
        for conn in self._connections:
            try:
                conn.send(msg)
            except Exception:
                pass

    async def handle_message(self, conn: Connection, msg: dict[str, Any]) -> None:
        """Process an incoming message from a consumer."""
        msg_type = msg.get("type")

        if msg_type == "subscribe":
            path = msg.get("path", "/")
            depth = msg.get("depth", -1)
            max_nodes = msg.get("max_nodes")
            filter_ = msg.get("filter")
            output = self._get_output_tree(path=path, depth=depth, max_nodes=max_nodes, filter_=filter_)
            if output is None:
                conn.send({
                    "type": "error",
                    "id": msg.get("id"),
                    "error": {
                        "code": "not_found",
                        "message": f"Path {path} does not exist in the state tree",
                    },
                })
                return
            self._subscriptions.append(_Subscription(
                id=msg["id"],
                path=path,
                depth=depth,
                connection=conn,
                last_tree=copy.deepcopy(output),
                max_nodes=max_nodes,
                filter_=filter_,
            ))
            conn.send({
                "type": "snapshot",
                "id": msg["id"],
                "version": self._version,
                "tree": output.to_dict(),
            })

        elif msg_type == "unsubscribe":
            self._subscriptions = [
                s for s in self._subscriptions
                if not (s.id == msg["id"] and s.connection is conn)
            ]

        elif msg_type == "query":
            path = msg.get("path", "/")
            depth = msg.get("depth", -1)
            max_nodes = msg.get("max_nodes")
            filter_ = msg.get("filter")
            window = msg.get("window")
            output = self._get_output_tree(path=path, depth=depth, max_nodes=max_nodes, filter_=filter_)
            if output is None:
                conn.send({
                    "type": "error",
                    "id": msg.get("id"),
                    "error": {
                        "code": "not_found",
                        "message": f"Path {path} does not exist in the state tree",
                    },
                })
                return
            if window and output.children:
                offset, count = window[0], window[1]
                total = len(output.children)
                sliced = output.children[offset:offset + count]
                meta = copy.copy(output.meta) if output.meta else NodeMeta()
                meta.total_children = total
                meta.window = (offset, len(sliced))
                output = SlopNode(
                    id=output.id,
                    type=output.type,
                    properties=output.properties,
                    children=sliced,
                    affordances=output.affordances,
                    meta=meta,
                )
            conn.send({
                "type": "snapshot",
                "id": msg["id"],
                "version": self._version,
                "tree": output.to_dict(),
            })

        elif msg_type == "invoke":
            await self._handle_invoke(conn, msg)

        else:
            conn.send({
                "type": "error",
                "id": msg.get("id"),
                "error": {
                    "code": "bad_request",
                    "message": f"Unknown message type: {msg.get('type')}",
                },
            })

    def handle_disconnect(self, conn: Connection) -> None:
        """Called by a transport when a consumer disconnects."""
        self._connections.discard(conn)
        self._subscriptions = [s for s in self._subscriptions if s.connection is not conn]

    def on_change(self, callback: Callable[[], None]) -> Callable[[], None]:
        """Register a callback fired after each tree change. Returns unsubscribe."""
        self._change_listeners.append(callback)
        return lambda: self._change_listeners.remove(callback)

    def stop(self) -> None:
        """Close all connections and clean up."""
        for conn in list(self._connections):
            try:
                conn.close()
            except Exception:
                pass
        self._connections.clear()
        self._subscriptions.clear()

    # --- Internal ---

    def _merge_decorator_actions(self, path: str, descriptor: dict[str, Any]) -> dict[str, Any]:
        extra = self._decorator_actions.get(path)
        if not extra:
            return descriptor
        merged = dict(descriptor)
        existing = merged.get("actions")
        if existing:
            # Descriptor already declares actions — treat as authoritative.
            # Only enrich existing actions with decorator metadata (fill gaps),
            # don't add new ones. This supports state-dependent affordances
            # where the descriptor intentionally omits certain actions.
            actions = dict(existing)
            for name, opts in extra.items():
                if name in actions:
                    if isinstance(actions[name], dict) and isinstance(opts, dict):
                        enriched = dict(opts)
                        enriched.update(actions[name])  # descriptor wins on conflicts
                        actions[name] = enriched
                    # else: descriptor's action def takes precedence
        else:
            # No actions in descriptor — add all decorator actions
            actions = dict(extra)
        merged["actions"] = actions
        return merged

    def _rebuild(self) -> None:
        all_descriptors: dict[str, dict[str, Any]] = {}

        # Evaluate dynamic registrations
        for path, fn in self._dynamic.items():
            try:
                desc = fn()
                all_descriptors[path] = self._merge_decorator_actions(path, desc)
            except Exception as e:
                import sys
                print(f"[slop] Error evaluating descriptor at '{path}': {e}", file=sys.stderr)

        # Static registrations
        for path, desc in self._static.items():
            all_descriptors[path] = desc

        tree, handlers = assemble_tree(all_descriptors, self.id, self.name)
        ops = diff_nodes(self._current_tree, tree)
        self._current_handlers = handlers

        if ops:
            self._current_tree = tree
            self._version += 1
            self._broadcast_patches(ops)
            for cb in self._change_listeners:
                cb()
        elif self._version == 0:
            self._current_tree = tree
            self._version = 1

    async def _handle_invoke(
        self,
        conn: Connection,
        msg: dict[str, Any],
    ) -> None:
        path = msg["path"]
        action = msg["action"]
        params = msg.get("params", {})

        handler = self._resolve_handler(path, action)
        if handler is None:
            conn.send({
                "type": "result",
                "id": msg["id"],
                "status": "error",
                "error": {"code": "not_found", "message": f"No handler for {action} at {path}"},
            })
            return

        try:
            data = handler(params)
            # Await if coroutine
            if inspect.isawaitable(data):
                data = await data

            is_async = isinstance(data, dict) and data.get("__async") is True
            result_data = None
            if isinstance(data, dict):
                result_data = {k: v for k, v in data.items() if k != "__async"} or None

            resp: dict[str, Any] = {
                "type": "result",
                "id": msg["id"],
                "status": "accepted" if is_async else "ok",
            }
            if result_data:
                resp["data"] = result_data
            conn.send(resp)

            # Auto-refresh after invoke
            self._rebuild()
        except Exception as e:
            conn.send({
                "type": "result",
                "id": msg["id"],
                "status": "error",
                "error": {"code": getattr(e, "code", "internal"), "message": str(e)},
            })

    def _resolve_handler(self, path: str, action: str) -> Callable[..., Any] | None:
        root_prefix = f"/{self.id}/"
        clean = path
        if clean.startswith(root_prefix):
            clean = clean[len(root_prefix):]
        elif clean.startswith("/"):
            clean = clean[1:]

        key = f"{clean}/{action}" if clean else action
        return self._current_handlers.get(key)

    def _get_output_tree(
        self,
        path: str = "/",
        depth: int | None = None,
        max_nodes: int | None = None,
        filter_: dict[str, Any] | None = None,
    ) -> SlopNode | None:
        """Resolve a subtree and apply depth/filter/max_nodes options."""
        tree = self._current_tree
        if path != "/":
            subtree = get_subtree(tree, path)
            if subtree is None:
                return None
            tree = subtree

        needs_prepare = (
            (depth is not None and depth >= 0)
            or max_nodes is not None
            or (filter_ is not None)
        )
        if needs_prepare:
            opts = OutputTreeOptions(
                max_depth=depth if (depth is not None and depth >= 0) else None,
                max_nodes=max_nodes,
                min_salience=filter_.get("min_salience") if filter_ else None,
                types=filter_.get("types") if filter_ else None,
            )
            tree = prepare_tree(tree, opts)

        return tree

    def _broadcast_patches(self, ops: list[PatchOp]) -> None:
        for sub in self._subscriptions:
            try:
                new_tree = self._get_output_tree(
                    path=sub.path, depth=sub.depth, max_nodes=sub.max_nodes, filter_=sub.filter_,
                )
                if new_tree is None:
                    continue
                sub_ops = diff_nodes(sub.last_tree, new_tree)
                if sub_ops:
                    sub.connection.send({
                        "type": "patch",
                        "subscription": sub.id,
                        "version": self._version,
                        "ops": [op.to_dict() for op in sub_ops],
                    })
                    sub.last_tree = copy.deepcopy(new_tree)
            except Exception:
                pass


class _Subscription:
    __slots__ = ("id", "path", "depth", "max_nodes", "filter_", "connection", "last_tree")

    def __init__(
        self,
        id: str,
        path: str,
        depth: int,
        connection: Connection,
        last_tree: SlopNode,
        max_nodes: int | None = None,
        filter_: dict[str, Any] | None = None,
    ) -> None:
        self.id = id
        self.path = path
        self.depth = depth
        self.max_nodes = max_nodes
        self.filter_ = filter_
        self.connection = connection
        self.last_tree = last_tree


class _ScopedServer:
    """A scoped view of a ``SlopServer`` that prefixes all paths.

    Usable as a context manager — unregisters all scoped paths on exit::

        with slop.scope("settings") as settings:
            settings.register("account", {"type": "group", "props": {...}})
        # "settings/account" and "settings" are unregistered here
    """

    def __init__(self, parent: SlopServer, prefix: str) -> None:
        self._parent = parent
        self._prefix = prefix
        self._paths: list[str] = []

    def register(self, path: str, descriptor: dict[str, Any]) -> None:
        full = f"{self._prefix}/{path}"
        self._parent.register(full, descriptor)
        self._paths.append(full)

    def node(self, path: str) -> Callable:
        return self._parent.node(f"{self._prefix}/{path}")

    def action(self, path: str, name: str, **kwargs: Any) -> Callable:
        return self._parent.action(f"{self._prefix}/{path}", name, **kwargs)

    def unregister(self, path: str, *, recursive: bool = False) -> None:
        full = f"{self._prefix}/{path}"
        self._parent.unregister(full, recursive=recursive)
        if full in self._paths:
            self._paths.remove(full)

    def scope(self, sub_prefix: str) -> _ScopedServer:
        return self._parent.scope(f"{self._prefix}/{sub_prefix}")

    def refresh(self) -> None:
        self._parent.refresh()

    def __enter__(self) -> _ScopedServer:
        return self

    def __exit__(self, *exc: Any) -> None:
        for path in reversed(self._paths):
            self._parent.unregister(path)
        self._paths.clear()
        self._parent.unregister(self._prefix)


def _wrap_handler(fn: Callable) -> Callable[[dict[str, Any]], Any]:
    """Wrap a user function so it receives unpacked keyword args."""
    sig = inspect.signature(fn)
    param_names = list(sig.parameters.keys())

    if not param_names:
        return lambda params: fn()

    def wrapper(params: dict[str, Any]) -> Any:
        kwargs = {k: params[k] for k in param_names if k in params}
        return fn(**kwargs)

    return wrapper
