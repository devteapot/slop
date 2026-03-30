"""Tests for SlopServer."""

import asyncio
import pytest

from slop import SlopServer


def _run(coro):
    """Run an async coroutine in tests."""
    return asyncio.run(coro)


class MockConnection:
    """A mock connection that records sent messages."""

    def __init__(self):
        self.messages: list[dict] = []
        self.closed = False

    def send(self, message: dict) -> None:
        self.messages.append(message)

    def close(self) -> None:
        self.closed = True


def test_register_static():
    slop = SlopServer("app", "App")
    slop.register("status", {"type": "status", "props": {"healthy": True}})
    assert slop.version == 1
    assert len(slop.tree.children) == 1
    assert slop.tree.children[0].id == "status"
    assert slop.tree.children[0].properties == {"healthy": True}


def test_node_decorator():
    slop = SlopServer("app", "App")
    counter = {"n": 0}

    @slop.node("counter")
    def counter_node():
        return {"type": "status", "props": {"count": counter["n"]}}

    assert slop.tree.children[0].properties == {"count": 0}

    counter["n"] = 5
    slop.refresh()
    assert slop.tree.children[0].properties == {"count": 5}


def test_action_decorator():
    slop = SlopServer("app", "App")
    result = {}

    slop.register("data", {"type": "group", "props": {"x": 1}})

    @slop.action("data", "update", params={"value": "number"})
    def update_data(value):
        result["value"] = value

    # Action should be in the tree as an affordance
    data_node = slop.tree.children[0]
    assert any(a.action == "update" for a in (data_node.affordances or []))


def test_connection_lifecycle():
    slop = SlopServer("app", "App")
    slop.register("x", {"type": "group"})
    conn = MockConnection()

    slop.handle_connection(conn)
    assert len(conn.messages) == 1
    assert conn.messages[0]["type"] == "hello"
    assert conn.messages[0]["provider"]["id"] == "app"

    # Subscribe
    _run(
        slop.handle_message(conn, {"type": "subscribe", "id": "sub-1"})
    )
    assert len(conn.messages) == 2
    snapshot = conn.messages[1]
    assert snapshot["type"] == "snapshot"
    assert snapshot["id"] == "sub-1"
    assert snapshot["tree"]["id"] == "app"

    # Query
    _run(
        slop.handle_message(conn, {"type": "query", "id": "q-1"})
    )
    assert conn.messages[2]["type"] == "snapshot"
    assert conn.messages[2]["id"] == "q-1"

    # Disconnect
    slop.handle_disconnect(conn)


def test_invoke():
    slop = SlopServer("app", "App")
    state = {"count": 0}

    slop.register("counter", {
        "type": "status",
        "props": {"count": state["count"]},
        "actions": {
            "increment": lambda params: state.update(count=state["count"] + 1),
        },
    })

    conn = MockConnection()
    slop.handle_connection(conn)

    _run(
        slop.handle_message(conn, {
            "type": "invoke",
            "id": "inv-1",
            "path": "/app/counter",
            "action": "increment",
        })
    )

    # Should get a result
    results = [m for m in conn.messages if m["type"] == "result"]
    assert len(results) == 1
    assert results[0]["status"] == "ok"


def test_invoke_not_found():
    slop = SlopServer("app", "App")
    conn = MockConnection()
    slop.handle_connection(conn)

    _run(
        slop.handle_message(conn, {
            "type": "invoke",
            "id": "inv-1",
            "path": "/app/missing",
            "action": "do_it",
        })
    )

    results = [m for m in conn.messages if m["type"] == "result"]
    assert results[0]["status"] == "error"
    assert results[0]["error"]["code"] == "not_found"


def test_scope():
    slop = SlopServer("app", "App")
    settings = slop.scope("settings")
    settings.register("account", {"type": "group", "props": {"email": "a@b.com"}})

    assert slop.tree.children[0].id == "settings"
    assert slop.tree.children[0].children[0].id == "account"


def test_unregister():
    slop = SlopServer("app", "App")
    slop.register("x", {"type": "group"})
    assert len(slop.tree.children) == 1

    slop.unregister("x")
    assert len(slop.tree.children or []) == 0


def test_broadcast_on_change():
    slop = SlopServer("app", "App")
    slop.register("x", {"type": "group", "props": {"v": 1}})

    conn = MockConnection()
    slop.handle_connection(conn)
    _run(
        slop.handle_message(conn, {"type": "subscribe", "id": "sub-1"})
    )
    initial_count = len(conn.messages)

    # Change triggers broadcast
    slop.register("x", {"type": "group", "props": {"v": 2}})
    assert len(conn.messages) > initial_count
    last = conn.messages[-1]
    assert last["type"] == "snapshot"
    assert last["version"] == slop.version
