"""App action helpers for the Hermes SLOP plugin."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol


class _ActionConsumer(Protocol):
    async def invoke(
        self,
        path: str,
        action: str,
        params: dict[str, Any],
    ) -> dict[str, Any]: ...


class _ActionProvider(Protocol):
    consumer: _ActionConsumer


class _ActionService(Protocol):
    async def ensure_connected(self, id_or_name: str) -> _ActionProvider | None: ...


@dataclass(slots=True)
class ActionResult:
    """Action outcome rendered for Hermes tool responses."""

    text: str
    is_error: bool = False


async def execute_action(
    service: _ActionService,
    *,
    app: str,
    path: str,
    action: str,
    params: dict[str, Any] | None = None,
) -> ActionResult:
    """Invoke a single affordance through the discovery service."""
    provider = await service.ensure_connected(app)
    if provider is None:
        return ActionResult(
            text=f'App "{app}" not found or could not connect.',
            is_error=True,
        )

    try:
        result = await provider.consumer.invoke(path, action, params or {})
    except Exception as exc:
        return ActionResult(text=f"Error: {exc}", is_error=True)

    status = result.get("status")
    if status == "ok":
        message = f"Done. {action} on {path} succeeded."
        if result.get("data") is not None:
            message += " Result: " + json.dumps(result["data"], ensure_ascii=False)
        return ActionResult(text=message)

    if status == "accepted":
        message = f"Accepted. {action} on {path} started successfully."
        if result.get("data") is not None:
            message += " Result: " + json.dumps(result["data"], ensure_ascii=False)
        return ActionResult(text=message)

    error = result.get("error") or {}
    code = error.get("code", "unknown")
    message = error.get("message", "Unknown error")
    return ActionResult(
        text=f"Action failed: [{code}] {message}",
        is_error=True,
    )


async def execute_action_batch(
    service: _ActionService,
    *,
    app: str,
    actions: list[dict[str, Any]],
) -> ActionResult:
    """Invoke multiple affordances through the discovery service."""
    provider = await service.ensure_connected(app)
    if provider is None:
        return ActionResult(
            text=f'App "{app}" not found or could not connect.',
            is_error=True,
        )

    lines: list[str] = []
    failed = 0

    for item in actions:
        path = str(item.get("path") or "/")
        action = str(item.get("action") or "")
        params = item.get("params")
        try:
            result = await provider.consumer.invoke(path, action, params or {})
        except Exception as exc:
            failed += 1
            lines.append(f"ERROR: {action} on {path} - {exc}")
            continue

        status = result.get("status")
        if status == "ok":
            lines.append(f"OK: {action} on {path}")
            continue
        if status == "accepted":
            lines.append(f"ACCEPTED: {action} on {path}")
            continue

        failed += 1
        error = result.get("error") or {}
        lines.append(
            "FAIL: "
            f"{action} on {path} - [{error.get('code', 'unknown')}] "
            f"{error.get('message', 'Unknown error')}"
        )

    succeeded = len(actions) - failed
    return ActionResult(
        text=(
            f"Batch complete: {succeeded}/{len(actions)} succeeded.\n"
            + "\n".join(lines)
        ),
        is_error=failed > 0,
    )
