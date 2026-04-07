# pyright: reportMissingImports=false

"""Prompt injection helpers for the Hermes SLOP plugin."""

from __future__ import annotations

import os
from typing import Any, Protocol

from slop_ai import OutputTreeOptions, format_tree, prepare_tree


class _RenderConsumer(Protocol):
    def get_tree(self, subscription_id: str) -> Any: ...


class _RenderProvider(Protocol):
    id: str
    name: str
    subscription_id: str
    consumer: _RenderConsumer


class _RenderDescriptorTransport(Protocol):
    type: str


class _RenderDescriptor(Protocol):
    id: str
    name: str
    source: str
    transport: _RenderDescriptorTransport


class _RenderService(Protocol):
    def get_providers(self) -> list[_RenderProvider]: ...
    def get_discovered(self) -> list[_RenderDescriptor]: ...


_DEFAULT_MAX_NODES = 160


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _env_float(name: str) -> float | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    try:
        return float(value)
    except ValueError:
        return None


def render_state_context(
    service: _RenderService,
    *,
    max_nodes: int | None = None,
    min_salience: float | None = None,
) -> str | None:
    """Render the current discovery state for Hermes prompt injection."""
    connected = list(service.get_providers())
    discovered = list(service.get_discovered())
    connected_ids = {provider.id for provider in connected}
    available = [desc for desc in discovered if desc.id not in connected_ids]

    if not connected and not available:
        return None

    effective_max_nodes = max_nodes or _env_int(
        "SLOP_HERMES_MAX_NODES", _DEFAULT_MAX_NODES
    )
    effective_min_salience = (
        min_salience
        if min_salience is not None
        else _env_float("SLOP_HERMES_MIN_SALIENCE")
    )

    lines = ["## SLOP Apps", ""]

    if connected:
        lines.append(
            f"{len(connected)} app(s) connected. Read the state trees below before acting. "
            "Use app_action or app_action_batch to invoke affordances, and call connect_app "
            "only when you need to connect a new app or force a refresh."
        )
        lines.append("")

        for provider in connected:
            tree = provider.consumer.get_tree(provider.subscription_id)
            lines.append(f"### {provider.name} ({provider.id})")
            lines.append("")
            if tree is None:
                lines.append("(awaiting state snapshot)")
                lines.append("")
                continue

            prepared = prepare_tree(
                tree,
                OutputTreeOptions(
                    max_nodes=effective_max_nodes,
                    min_salience=effective_min_salience,
                ),
            )
            lines.append("```")
            lines.append(format_tree(prepared))
            lines.append("```")
            lines.append("")

    if available:
        lines.append("### Available (not connected)")
        lines.append("")
        for desc in available:
            lines.append(
                f"- **{desc.name}** (id: `{desc.id}`, {desc.transport.type}, {desc.source})"
            )
        lines.append("")
        lines.append("Call connect_app with an app name to connect it.")

    return "\n".join(lines).strip()
