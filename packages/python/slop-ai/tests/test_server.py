"""Tests for SlopServer."""

import asyncio
import pytest

from slop_ai import SlopServer


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
    assert last["type"] == "patch"
    assert last["version"] == slop.version
    assert "ops" in last
    assert len(last["ops"]) > 0


# --- Depth / filter / error / event / window tests ---


def test_subscribe_depth_truncation():
    """Subscribe with depth=1 should stub children at depth 2."""
    slop = SlopServer("app", "App")
    slop.register("parent", {
        "type": "group",
        "items": [
            {"id": "child-a", "type": "item", "props": {"v": 1}},
        ],
    })

    conn = MockConnection()
    slop.handle_connection(conn)
    _run(slop.handle_message(conn, {
        "type": "subscribe",
        "id": "sub-depth",
        "path": "/",
        "depth": 1,
    }))

    snapshot = conn.messages[-1]
    assert snapshot["type"] == "snapshot"
    tree = snapshot["tree"]
    # root -> parent (depth 0->1 ok), parent -> child-a (depth 1->2, should be stub)
    parent = tree["children"][0]
    assert parent["id"] == "parent"
    # At depth=1 the parent node's children should be stubs (no children of their own)
    # The parent node is at depth 1 so its children should be truncated to stubs
    if parent.get("children"):
        for child in parent["children"]:
            assert "children" not in child or child.get("children") is None
    else:
        # parent itself was stubbed — it should have meta.total_children
        assert parent.get("meta", {}).get("total_children") is not None


def test_subscribe_min_salience_filter():
    """Subscribe with min_salience filter excludes low-salience nodes."""
    slop = SlopServer("app", "App")
    slop.register("high", {"type": "item", "props": {"v": 1}, "meta": {"salience": 0.9}})
    slop.register("low", {"type": "item", "props": {"v": 2}, "meta": {"salience": 0.1}})

    conn = MockConnection()
    slop.handle_connection(conn)
    _run(slop.handle_message(conn, {
        "type": "subscribe",
        "id": "sub-sal",
        "path": "/",
        "depth": -1,
        "filter": {"min_salience": 0.5},
    }))

    snapshot = conn.messages[-1]
    assert snapshot["type"] == "snapshot"
    child_ids = [c["id"] for c in snapshot["tree"].get("children", [])]
    assert "high" in child_ids
    assert "low" not in child_ids


def test_unknown_message_type_error():
    """Unknown message type returns an error with code bad_request."""
    slop = SlopServer("app", "App")
    conn = MockConnection()
    slop.handle_connection(conn)

    _run(slop.handle_message(conn, {"type": "bogus", "id": "x-1"}))

    errors = [m for m in conn.messages if m["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["id"] == "x-1"
    assert errors[0]["error"]["code"] == "bad_request"
    assert "bogus" in errors[0]["error"]["message"]


def test_subscribe_nonexistent_path_error():
    """Subscribe to a path that doesn't exist returns error not_found."""
    slop = SlopServer("app", "App")
    slop.register("x", {"type": "group"})

    conn = MockConnection()
    slop.handle_connection(conn)
    _run(slop.handle_message(conn, {
        "type": "subscribe",
        "id": "sub-miss",
        "path": "/nonexistent",
    }))

    errors = [m for m in conn.messages if m["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["error"]["code"] == "not_found"


def test_emit_event():
    """emit_event sends event message to all connections."""
    slop = SlopServer("app", "App")
    conn1 = MockConnection()
    conn2 = MockConnection()
    slop.handle_connection(conn1)
    slop.handle_connection(conn2)

    slop.emit_event("refresh", {"reason": "test"})

    for conn in (conn1, conn2):
        events = [m for m in conn.messages if m["type"] == "event"]
        assert len(events) == 1
        assert events[0]["name"] == "refresh"
        assert events[0]["data"] == {"reason": "test"}


def test_query_with_window():
    """Query with window returns sliced children and meta."""
    slop = SlopServer("app", "App")
    slop.register("list", {
        "type": "collection",
        "items": [{"id": f"item-{i}", "type": "item", "props": {"i": i}} for i in range(10)],
    })

    conn = MockConnection()
    slop.handle_connection(conn)
    _run(slop.handle_message(conn, {
        "type": "query",
        "id": "q-win",
        "path": "/list",
        "depth": -1,
        "window": [2, 3],
    }))

    snapshot = [m for m in conn.messages if m["type"] == "snapshot"][-1]
    tree = snapshot["tree"]
    children = tree.get("children", [])
    assert len(children) == 3
    assert children[0]["id"] == "item-2"
    assert children[2]["id"] == "item-4"
    meta = tree.get("meta", {})
    assert meta["total_children"] == 10
    assert meta["window"] == [2, 3]
