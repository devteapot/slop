# pyright: reportMissingImports=false

"""Background discovery runtime for the Hermes SLOP plugin."""

from __future__ import annotations

import asyncio
import atexit
import contextlib
import logging
import threading
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Any

from slop_ai.discovery import (
    DiscoveryService,
    DiscoveryOptions,
    ToolHandlers,
    ToolResult,
    create_discovery_service,
    create_tool_handlers,
)

from .actions import ActionResult, execute_action, execute_action_batch
from .render import render_state_context

logger = logging.getLogger(__name__)


class SlopHermesRuntime:
    """Owns a background asyncio loop and discovery service."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._loop_ready = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._service: DiscoveryService | None = None
        self._handlers: ToolHandlers | None = None
        self._started = False
        self._stopping = False
        atexit.register(self.stop)

    def ensure_started(self) -> None:
        """Start the background runtime if needed."""
        with self._lock:
            if self._started:
                return
            if self._thread is None or not self._thread.is_alive():
                self._loop_ready.clear()
                self._loop = asyncio.new_event_loop()
                self._thread = threading.Thread(
                    target=self._run_loop,
                    name="slop-hermes-runtime",
                    daemon=True,
                )
                self._thread.start()

        if not self._loop_ready.wait(timeout=5.0):
            self.stop()
            raise RuntimeError("Timed out starting the SLOP Hermes runtime loop")

        try:
            self._run_coro(self._async_start(), timeout=15.0)
        except Exception:
            self.stop()
            raise

        with self._lock:
            self._started = True

    def stop(self) -> None:
        """Stop discovery and tear down the background loop."""
        with self._lock:
            if self._stopping:
                return
            self._stopping = True
            loop = self._loop
            thread = self._thread

        try:
            if loop is not None and loop.is_running():
                with contextlib.suppress(Exception):
                    self._run_coro(self._async_stop(), timeout=10.0)
                loop.call_soon_threadsafe(loop.stop)
            if thread is not None and thread.is_alive():
                thread.join(timeout=5.0)
        finally:
            with self._lock:
                self._service = None
                self._handlers = None
                self._loop = None
                self._thread = None
                self._started = False
                self._stopping = False

    def list_apps(self) -> ToolResult:
        self.ensure_started()
        return self._run_coro(self._require_handlers().list_apps())

    def connect_app(self, app: str) -> ToolResult:
        self.ensure_started()
        return self._run_coro(self._require_handlers().connect_app(app))

    def disconnect_app(self, app: str) -> ToolResult:
        self.ensure_started()
        return self._run_coro(self._require_handlers().disconnect_app(app))

    def app_action(
        self,
        *,
        app: str,
        path: str,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> ActionResult:
        self.ensure_started()
        return self._run_coro(
            execute_action(
                self._require_service(),
                app=app,
                path=path,
                action=action,
                params=params,
            )
        )

    def app_action_batch(
        self,
        *,
        app: str,
        actions: list[dict[str, Any]],
    ) -> ActionResult:
        self.ensure_started()
        return self._run_coro(
            execute_action_batch(self._require_service(), app=app, actions=actions)
        )

    def build_context(self) -> str | None:
        self.ensure_started()
        return self._run_coro(self._render_context())

    async def _async_start(self) -> None:
        if self._service is not None and self._handlers is not None:
            return
        service = create_discovery_service(DiscoveryOptions(logger=logger))
        handlers = create_tool_handlers(service)
        await service.start()
        self._service = service
        self._handlers = handlers

    async def _async_stop(self) -> None:
        if self._service is None:
            return
        await self._service.stop()
        self._service = None
        self._handlers = None

    async def _render_context(self) -> str | None:
        return render_state_context(self._require_service())

    def _run_loop(self) -> None:
        loop = self._loop
        assert loop is not None
        asyncio.set_event_loop(loop)
        self._loop_ready.set()
        try:
            loop.run_forever()
        finally:
            pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
            for task in pending:
                task.cancel()
            if pending:
                with contextlib.suppress(Exception):
                    loop.run_until_complete(
                        asyncio.gather(*pending, return_exceptions=True)
                    )
            with contextlib.suppress(Exception):
                loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    def _run_coro(self, coro: Any, *, timeout: float = 10.0) -> Any:
        with self._lock:
            loop = self._loop
        if loop is None or not loop.is_running():
            raise RuntimeError("SLOP Hermes runtime is not running")
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise TimeoutError("Timed out waiting for SLOP Hermes runtime") from exc

    def _require_service(self) -> DiscoveryService:
        if self._service is None:
            raise RuntimeError("SLOP discovery service is not ready")
        return self._service

    def _require_handlers(self) -> ToolHandlers:
        if self._handlers is None:
            raise RuntimeError("SLOP discovery handlers are not ready")
        return self._handlers


_runtime: SlopHermesRuntime | None = None


def get_runtime() -> SlopHermesRuntime:
    """Return the process-global plugin runtime."""
    global _runtime
    if _runtime is None:
        _runtime = SlopHermesRuntime()
    return _runtime
