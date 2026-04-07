from __future__ import annotations

import asyncio

from slop_hermes.actions import execute_action, execute_action_batch


def test_execute_action_ok_result_includes_data() -> None:
    async def _run() -> None:
        service = _FakeService({"status": "ok", "data": {"id": "todo-1"}})
        result = await execute_action(
            service,
            app="todos",
            path="/todos",
            action="create",
            params={"title": "Ship plugin"},
        )

        assert result.is_error is False
        assert "create on /todos succeeded" in result.text
        assert '"id": "todo-1"' in result.text

    asyncio.run(_run())


def test_execute_action_error_result_uses_protocol_error() -> None:
    async def _run() -> None:
        service = _FakeService(
            {
                "status": "error",
                "error": {"code": "forbidden", "message": "Nope"},
            }
        )
        result = await execute_action(
            service,
            app="todos",
            path="/todos/item-1",
            action="delete",
        )

        assert result.is_error is True
        assert result.text == "Action failed: [forbidden] Nope"

    asyncio.run(_run())


def test_execute_action_batch_reports_partial_failure() -> None:
    async def _run() -> None:
        service = _FakeService(
            [
                {"status": "ok"},
                {"status": "accepted"},
                {
                    "status": "error",
                    "error": {"code": "bad_request", "message": "Missing title"},
                },
            ]
        )
        result = await execute_action_batch(
            service,
            app="todos",
            actions=[
                {"path": "/todos", "action": "create", "params": {"title": "A"}},
                {"path": "/todos", "action": "sync"},
                {"path": "/todos", "action": "create", "params": {}},
            ],
        )

        assert result.is_error is True
        assert result.text.startswith("Batch complete: 2/3 succeeded.")
        assert "OK: create on /todos" in result.text
        assert "ACCEPTED: sync on /todos" in result.text
        assert "FAIL: create on /todos - [bad_request] Missing title" in result.text

    asyncio.run(_run())


class _FakeService:
    def __init__(self, invoke_result):
        self._provider = _FakeProvider(invoke_result)

    async def ensure_connected(self, app: str):
        if app == "missing":
            return None
        return self._provider


class _FakeProvider:
    def __init__(self, invoke_result):
        self.consumer = _FakeConsumer(invoke_result)


class _FakeConsumer:
    def __init__(self, invoke_result):
        if isinstance(invoke_result, list):
            self._results = list(invoke_result)
        else:
            self._results = [invoke_result]

    async def invoke(self, path, action, params):
        return self._results.pop(0)
