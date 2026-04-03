"""Mount a remote browser UI tree into a SlopServer.

Implements the provider side of the SLOP protocol: connects to a browser
provider (via WebSocket), subscribes to its full tree, and re-registers it
as a local node so AI consumers see a merged server+UI tree.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import weakref
from typing import Any, Callable, Awaitable
from urllib.parse import parse_qs

from slop_ai.server import SlopServer, Connection
from slop_ai.types import SlopNode

logger = logging.getLogger("slop.ui_mount")

# ASGI type aliases
Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]

NODE_FIELDS = {"properties", "meta", "affordances", "content_ref"}
_ACTIVE_MOUNTS: "weakref.WeakKeyDictionary[SlopServer, dict[str, UiMountSession]]" = weakref.WeakKeyDictionary()


class UiMountSession:
    """Manages a single browser provider connection.

    Subscribes to the remote tree, mounts it on the SlopServer at *mount_path*,
    and proxies invoke calls back to the browser.
    """

    _counter = 0

    def __init__(self, slop: SlopServer, send: Callable[[dict[str, Any]], None], mount_path: str) -> None:
        UiMountSession._counter += 1
        self._id = f"ui-session-{UiMountSession._counter}"
        self._slop = slop
        self._send = send
        self._mount_path = mount_path
        self._sub_id = f"{self._id}-sub"
        self._remote_tree: dict[str, Any] | None = None
        self._remote_root_id = "ui"
        self._mounted = False
        self._active = True
        self._request_counter = 0
        self._pending: dict[str, asyncio.Future[Any]] = {}

    def start(self) -> None:
        self._send({"type": "connect"})

    def handle_message(self, msg: dict[str, Any]) -> None:
        if not self._active:
            return
        msg_type = msg.get("type")

        if msg_type == "hello":
            self._remote_root_id = (msg.get("provider") or {}).get("id", self._remote_root_id)
            self._send({
                "type": "subscribe",
                "id": self._sub_id,
                "path": "/",
                "depth": -1,
            })

        elif msg_type == "snapshot":
            if msg.get("id") == self._sub_id:
                self._apply_snapshot(msg["tree"])
            else:
                self._resolve_pending(msg.get("id"), msg.get("tree"))

        elif msg_type == "patch":
            if msg.get("subscription") == self._sub_id:
                self._apply_patch(msg.get("ops", []))

        elif msg_type == "result":
            try:
                value = _normalize_result(msg)
                self._resolve_pending(msg.get("id"), value)
            except Exception as exc:
                self._reject_pending(msg.get("id"), exc)

        elif msg_type == "error":
            err_msg = (msg.get("error") or {}).get("message", "Remote UI error")
            self._reject_pending(msg.get("id"), RuntimeError(err_msg))

        elif msg_type == "batch":
            for inner in msg.get("messages", []):
                self.handle_message(inner)

    def deactivate(self, reason: str = "UI session ended") -> None:
        if not self._active:
            return
        self._active = False

        if self._mounted:
            self._slop.unregister(self._mount_path)
            self._mounted = False

        try:
            self._send({"type": "unsubscribe", "id": self._sub_id})
        except Exception:
            pass

        exc = RuntimeError(reason)
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()

    async def request_refresh(self) -> None:
        if not self._active or not self._remote_tree:
            return
        try:
            await self._invoke_remote(f"/{self._remote_root_id}/__adapter", "refresh", {})
        except Exception:
            logger.debug("failed to refresh mounted UI session", exc_info=True)

    # --- Internal ---

    def _apply_snapshot(self, tree: dict[str, Any]) -> None:
        self._remote_tree = copy.deepcopy(tree)
        self._remote_root_id = tree.get("id", self._remote_root_id)

        if not self._mounted:
            self._slop.node(self._mount_path)(self._build_descriptor)
            self._mounted = True
        else:
            self._slop.refresh()

    def _apply_patch(self, ops: list[dict[str, Any]]) -> None:
        if not self._remote_tree:
            return
        _apply_patch_ops(self._remote_tree, ops)
        self._slop.refresh()

    def _build_descriptor(self) -> dict[str, Any]:
        if not self._remote_tree:
            return {"type": "group"}
        return _node_to_descriptor(
            self._remote_tree,
            f"/{self._remote_root_id}",
            self._invoke_remote,
            is_root=True,
        )

    def _invoke_remote(self, path: str, action: str, params: dict[str, Any]) -> Any:
        if not self._active:
            raise RuntimeError("UI session is no longer active")
        self._request_counter += 1
        req_id = f"{self._id}-invoke-{self._request_counter}"
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[Any] = loop.create_future()
        self._pending[req_id] = fut
        self._send({
            "type": "invoke",
            "id": req_id,
            "path": path,
            "action": action,
            "params": params,
        })
        return fut

    def _resolve_pending(self, req_id: str | None, value: Any) -> None:
        if not req_id:
            return
        fut = self._pending.pop(req_id, None)
        if fut and not fut.done():
            fut.set_result(value)

    def _reject_pending(self, req_id: str | None, exc: Exception) -> None:
        if not req_id:
            return
        fut = self._pending.pop(req_id, None)
        if fut and not fut.done():
            fut.set_exception(exc)


# --- Tree conversion helpers ---

def _node_to_descriptor(
    node: dict[str, Any],
    remote_path: str,
    invoke: Callable[[str, str, dict[str, Any]], Any],
    is_root: bool = False,
) -> dict[str, Any]:
    node_type = node.get("type", "group")
    if is_root and node_type == "root":
        node_type = "group"

    desc: dict[str, Any] = {"type": node_type}

    if node.get("properties"):
        desc["props"] = copy.deepcopy(node["properties"])

    if node.get("meta"):
        desc["meta"] = copy.deepcopy(node["meta"])

    if node.get("content_ref"):
        desc["content_ref"] = copy.deepcopy(node["content_ref"])

    affordances = node.get("affordances")
    if affordances:
        actions: dict[str, Any] = {}
        for aff in affordances:
            action_name = aff["action"]
            action_def: dict[str, Any] = {}
            for key in ("label", "description", "dangerous", "idempotent", "estimate"):
                if aff.get(key):
                    action_def[key] = aff[key]
            if aff.get("params"):
                action_def["params"] = _schema_to_param_defs(aff["params"])

            # Capture for closure
            rp, an = remote_path, action_name
            action_def["handler"] = lambda params, _rp=rp, _an=an: invoke(_rp, _an, params)
            actions[action_name] = action_def
        desc["actions"] = actions

    children = node.get("children")
    if children:
        desc["children"] = {
            child["id"]: _node_to_descriptor(
                child,
                f"{remote_path}/{child['id']}",
                invoke,
            )
            for child in children
        }

    return desc


def _schema_to_param_defs(schema: dict[str, Any]) -> dict[str, Any]:
    if schema.get("type") != "object" or not schema.get("properties"):
        return {}
    params: dict[str, Any] = {}
    for key, value in schema["properties"].items():
        p: dict[str, Any] = {"type": value.get("type", "string")}
        if value.get("description"):
            p["description"] = value["description"]
        if value.get("enum"):
            p["enum"] = value["enum"]
        params[key] = p
    return params


def _normalize_result(msg: dict[str, Any]) -> Any:
    if msg.get("status") == "error":
        raise RuntimeError((msg.get("error") or {}).get("message", "Remote invoke failed"))
    return msg.get("data")


def register_mount_session(slop: SlopServer, mount_path: str, session: UiMountSession) -> None:
    mounts = _ACTIVE_MOUNTS.setdefault(slop, {})
    existing = mounts.get(mount_path)
    if existing is not None and existing is not session:
        existing.deactivate("Browser UI session replaced by a newer tab")
    mounts[mount_path] = session


def unregister_mount_session(slop: SlopServer, mount_path: str, session: UiMountSession) -> None:
    mounts = _ACTIVE_MOUNTS.get(slop)
    if not mounts:
        return
    if mounts.get(mount_path) is session:
        del mounts[mount_path]


async def refresh_mounted_ui(slop: SlopServer, source_path: str | None = None) -> None:
    mounts = _ACTIVE_MOUNTS.get(slop)
    if not mounts:
        return

    refreshes = [
        session.request_refresh()
        for mount_path, session in mounts.items()
        if not _path_targets_mount(slop, source_path, mount_path)
    ]
    if refreshes:
        await asyncio.gather(*refreshes, return_exceptions=True)


def schedule_mounted_ui_refresh(slop: SlopServer, source_path: str | None = None) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("skipping mounted UI refresh because no event loop is running")
        return
    loop.create_task(refresh_mounted_ui(slop, source_path))


def _path_targets_mount(slop: SlopServer, path: str | None, mount_path: str) -> bool:
    if not path:
        return False

    root_prefix = f"/{slop.id}/"
    clean = path
    if clean.startswith(root_prefix):
        clean = clean[len(root_prefix):]
    elif clean.startswith("/"):
        clean = clean[1:]

    return clean == mount_path or clean.startswith(f"{mount_path}/")


# --- Patch application ---

def _apply_patch_ops(root: dict[str, Any], ops: list[dict[str, Any]]) -> None:
    for op in ops:
        path = op.get("path", "")
        segments = [s for s in path.split("/") if s]
        if not segments:
            continue
        op_type = op.get("op")
        if op_type == "replace":
            target = _navigate(root, segments)
            if target:
                target["parent"][target["key"]] = op.get("value")
        elif op_type == "add":
            if not _is_field_segment(segments):
                parent = _resolve_node(root, segments[:-1])
                if parent is not None:
                    if "children" not in parent:
                        parent["children"] = []
                    parent["children"].append(op.get("value"))
            else:
                target = _navigate(root, segments)
                if target:
                    target["parent"][target["key"]] = op.get("value")
        elif op_type == "remove":
            if not _is_field_segment(segments):
                parent = _resolve_node(root, segments[:-1])
                child_id = segments[-1]
                if parent and parent.get("children"):
                    parent["children"] = [c for c in parent["children"] if c.get("id") != child_id]
            else:
                target = _navigate(root, segments)
                if target:
                    target["parent"].pop(target["key"], None)


def _navigate(root: dict[str, Any], segments: list[str]) -> dict[str, str] | None:
    current = root
    for seg in segments[:-1]:
        if seg in NODE_FIELDS:
            nxt = current.get(seg)
            if not isinstance(nxt, dict):
                return None
            current = nxt
            continue
        children = current.get("children")
        if not isinstance(children, list):
            return None
        child = next((c for c in children if c.get("id") == seg), None)
        if child is None:
            return None
        current = child
    return {"parent": current, "key": segments[-1]}


def _is_field_segment(segments: list[str]) -> bool:
    if len(segments) == 1:
        return segments[0] in NODE_FIELDS
    return any(s in NODE_FIELDS for s in segments[:-1])


def _resolve_node(root: dict[str, Any], segments: list[str]) -> dict[str, Any] | None:
    current = root
    for seg in segments:
        if seg in NODE_FIELDS:
            continue
        children = current.get("children")
        if not isinstance(children, list):
            return None
        child = next((c for c in children if c.get("id") == seg), None)
        if child is None:
            return None
        current = child
    return current


# --- ASGI WebSocket handler for provider connections ---

def parse_query_string(scope: Scope) -> dict[str, list[str]]:
    qs = scope.get("query_string", b"").decode()
    return parse_qs(qs)


def is_provider_connection(scope: Scope) -> bool:
    params = parse_query_string(scope)
    return params.get("slop_role", [None])[0] == "provider"


def get_mount_path(scope: Scope, default: str = "ui") -> str:
    params = parse_query_string(scope)
    values = params.get("mount", [default])
    return values[0]


async def handle_provider_websocket(
    slop: SlopServer,
    scope: Scope,
    receive: Receive,
    send: Send,
    mount_path: str = "ui",
) -> None:
    """Handle a browser UI provider WebSocket connection.

    Accepts the WebSocket, creates a UiMountSession, and processes messages
    until the connection closes.
    """
    event = await receive()
    if event["type"] != "websocket.connect":
        return
    await send({"type": "websocket.accept"})

    def ws_send(msg: dict[str, Any]) -> None:
        asyncio.ensure_future(send({
            "type": "websocket.send",
            "text": json.dumps(msg),
        }))

    session = UiMountSession(slop, ws_send, mount_path)
    register_mount_session(slop, mount_path, session)
    session.start()

    try:
        while True:
            event = await receive()
            if event["type"] == "websocket.receive":
                text = event.get("text", "")
                if text:
                    try:
                        msg = json.loads(text)
                        session.handle_message(msg)
                    except json.JSONDecodeError:
                        pass
            elif event["type"] == "websocket.disconnect":
                break
    finally:
        unregister_mount_session(slop, mount_path, session)
        session.deactivate("Browser disconnected")
