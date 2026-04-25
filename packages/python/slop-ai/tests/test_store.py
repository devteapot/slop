from __future__ import annotations

from typing import Any, Callable

from slop_ai import SlopServer, expose_store


class _TestStore:
    def __init__(self, state: dict[str, Any]) -> None:
        self.state = state
        self.listeners: list[Callable[[], None]] = []

    def get_state(self) -> dict[str, Any]:
        return self.state

    def subscribe(self, listener: Callable[[], None]) -> Callable[[], None]:
        self.listeners.append(listener)

        def unsubscribe() -> None:
            self.listeners.remove(listener)

        return unsubscribe

    def set_state(self, state: dict[str, Any]) -> None:
        self.state = state
        for listener in list(self.listeners):
            listener()


def test_expose_store_registers_and_updates() -> None:
    slop = SlopServer("app", "App")
    store = _TestStore({"count": 1})

    expose_store(
        slop,
        "counter",
        store,
        lambda state: {"type": "status", "props": {"count": state["count"]}},
    )

    assert slop.tree.children[0].properties["count"] == 1

    store.set_state({"count": 2})

    assert slop.tree.children[0].properties["count"] == 2


def test_expose_store_cleanup_unsubscribes_and_unregisters_recursively() -> None:
    slop = SlopServer("app", "App")
    store = _TestStore({"count": 1})
    slop.register("counter/details", {"type": "group"})

    dispose = expose_store(
        slop,
        "counter",
        store,
        lambda state: {"type": "status", "props": {"count": state["count"]}},
    )

    assert len(store.listeners) == 1

    dispose()

    assert len(store.listeners) == 0
    assert slop.tree.children == []

    store.set_state({"count": 2})
    assert slop.tree.children == []


def test_expose_store_dynamic_path_and_equals() -> None:
    slop = SlopServer("app", "App")
    store = _TestStore({"board": "one", "count": 1, "ignored": "a"})
    project_count = 0

    def project(state: dict[str, Any]) -> dict[str, Any]:
        nonlocal project_count
        project_count += 1
        return {"type": "view", "props": {"count": state["count"]}}

    expose_store(
        slop,
        lambda state: f"boards/{state['board']}",
        store,
        project,
        equals=lambda previous, next_state: previous["board"] == next_state["board"]
        and previous["count"] == next_state["count"],
    )

    store.set_state({"board": "one", "count": 1, "ignored": "b"})
    assert project_count == 1

    store.set_state({"board": "two", "count": 3, "ignored": "b"})

    boards = slop.tree.children[0]
    assert boards.id == "boards"
    assert boards.children[0].id == "two"
    assert boards.children[0].properties["count"] == 3
    assert project_count == 2
