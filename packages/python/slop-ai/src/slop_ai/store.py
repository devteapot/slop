"""Helpers for binding application stores to SLOP registrations."""

from __future__ import annotations

from threading import RLock, Timer
from typing import Any, Callable, Protocol, TypeVar, runtime_checkable

StateT = TypeVar("StateT")
StoreUnsubscribe = Callable[[], None]
StorePath = str | Callable[[StateT], str]


@runtime_checkable
class StoreSubscription(Protocol):
    """Subscription object returned by some state libraries."""

    def unsubscribe(self) -> None: ...


StoreSubscribeResult = StoreUnsubscribe | StoreSubscription


@runtime_checkable
class StateStore(Protocol[StateT]):
    """Minimal store shape supported by :func:`expose_store`."""

    def get_state(self) -> StateT: ...
    def subscribe(self, listener: Callable[[], None]) -> StoreSubscribeResult: ...


@runtime_checkable
class StoreTarget(Protocol):
    """Minimal SLOP registration target supported by :func:`expose_store`."""

    def register(self, path: str, descriptor: dict[str, Any]) -> None: ...
    def unregister(self, path: str, *, recursive: bool = False) -> None: ...


def expose_store(
    target: StoreTarget,
    path: StorePath[StateT],
    store: StateStore[StateT],
    project: Callable[[StateT], dict[str, Any]],
    *,
    equals: Callable[[StateT, StateT], bool] | None = None,
    debounce_ms: int = 0,
) -> StoreUnsubscribe:
    """Bind a generic state store to a SLOP node.

    The store supplies change notifications; ``project`` decides what semantic
    state and affordances to expose. This works with any Python store object
    that has ``get_state()`` plus ``subscribe(listener)``.
    """

    lock = RLock()
    current_path: str | None = None
    previous_state: StateT | None = None
    has_previous_state = False
    disposed = False
    timer: Timer | None = None

    def update() -> None:
        nonlocal current_path, previous_state, has_previous_state

        with lock:
            if disposed:
                return

            state = store.get_state()
            if has_previous_state and equals is not None and equals(previous_state, state):  # type: ignore[arg-type]
                return

            next_path = path(state) if callable(path) else path
            if current_path is not None and current_path != next_path:
                target.unregister(current_path, recursive=True)

            target.register(next_path, project(state))
            current_path = next_path
            previous_state = state
            has_previous_state = True

    def schedule_update() -> None:
        nonlocal timer

        with lock:
            if disposed:
                return
            if debounce_ms <= 0:
                update()
                return
            if timer is not None:
                timer.cancel()
            timer = Timer(debounce_ms / 1000, update)
            timer.daemon = True
            timer.start()

    update()
    subscription = store.subscribe(schedule_update)

    def dispose() -> None:
        nonlocal current_path, disposed, timer

        with lock:
            disposed = True
            if timer is not None:
                timer.cancel()
                timer = None
            _dispose_subscription(subscription)
            if current_path is not None:
                target.unregister(current_path, recursive=True)
                current_path = None

    return dispose


def _dispose_subscription(subscription: StoreSubscribeResult) -> None:
    if callable(subscription):
        subscription()
    else:
        subscription.unsubscribe()
