"""AI-facing discovery helpers for dynamic tools and core handlers."""

from __future__ import annotations

import re
from dataclasses import dataclass

from slop_ai.tools import affordances_to_tools, format_tree

from .models import DynamicToolEntry, DynamicToolResolution, DynamicToolSet, ToolResult

_SANITIZE_RE = re.compile(r"[^a-zA-Z0-9]")


def _sanitize_prefix(value: str) -> str:
    return _SANITIZE_RE.sub("_", value).strip("_")


def create_dynamic_tools(service: object) -> DynamicToolSet:
    """Build provider-prefixed dynamic affordance tools from connected providers."""
    entries: list[DynamicToolEntry] = []
    resolve_map: dict[str, DynamicToolResolution] = {}

    for provider in service.get_providers():
        tree = provider.consumer.get_tree(provider.subscription_id)
        if tree is None:
            continue

        prefix = _sanitize_prefix(provider.id)
        tool_set = affordances_to_tools(tree)
        for tool in tool_set.tools:
            resolution = tool_set.resolve(tool["function"]["name"])
            if resolution is None:
                continue
            dynamic_name = f"{prefix}__{tool['function']['name']}"
            entries.append(
                DynamicToolEntry(
                    name=dynamic_name,
                    description=f"[{provider.name}] {tool['function']['description']}",
                    input_schema=tool["function"]["parameters"],
                    provider_id=provider.id,
                    path=resolution.path,
                    action=resolution.action,
                )
            )
            resolve_map[dynamic_name] = DynamicToolResolution(
                provider_id=provider.id,
                path=resolution.path,
                action=resolution.action,
            )

    return DynamicToolSet(tools=entries, _resolve_map=resolve_map)


@dataclass(slots=True)
class ToolHandlers:
    """Core host-agnostic discovery tool handlers."""

    service: object

    async def list_apps(self) -> ToolResult:
        discovered = self.service.get_discovered()
        if not discovered:
            return ToolResult(
                content=[
                    {
                        "type": "text",
                        "text": "No applications found. Desktop and web apps that support external control will appear here automatically when they're running.",
                    }
                ]
            )

        connected = {provider.id: provider for provider in self.service.get_providers()}
        lines: list[str] = []
        for desc in discovered:
            provider = connected.get(desc.id)
            tree = (
                provider.consumer.get_tree(provider.subscription_id)
                if provider
                else None
            )
            action_count = len(affordances_to_tools(tree).tools) if tree else 0
            label = tree.properties.get("label") if tree and tree.properties else None
            if not isinstance(label, str) or not label:
                label = desc.name
            status = f"connected, {action_count} actions" if provider else "available"
            lines.append(
                f"- **{label}** (id: `{desc.id}`, {desc.transport.type}) - {status}"
            )

        return ToolResult(
            content=[
                {
                    "type": "text",
                    "text": "Applications on this computer:\n"
                    + "\n".join(lines)
                    + "\n\nUse connect_app with an app name or ID to connect and inspect it.",
                }
            ]
        )

    async def connect_app(self, app: str) -> ToolResult:
        provider = await self.service.ensure_connected(app)
        if provider is None:
            available = (
                ", ".join(
                    f"{desc.name} ({desc.id})" for desc in self.service.get_discovered()
                )
                or "none"
            )
            return ToolResult(
                content=[
                    {
                        "type": "text",
                        "text": f'App "{app}" not found. Available: {available}',
                    }
                ],
                is_error=True,
            )

        tree = provider.consumer.get_tree(provider.subscription_id)
        if tree is None:
            return ToolResult(
                content=[
                    {
                        "type": "text",
                        "text": f"{provider.name} is connected but has no state yet.",
                    }
                ]
            )

        tool_set = affordances_to_tools(tree)
        actions_text = "\n".join(
            f"  - **{(resolution.action if resolution else tool['function']['name'])}** on `{(resolution.path if resolution else '/')}`: {tool['function']['description']}"
            for tool in tool_set.tools
            for resolution in [tool_set.resolve(tool["function"]["name"])]
        )

        return ToolResult(
            content=[
                {
                    "type": "text",
                    "text": (
                        f"## {provider.name}\n"
                        f"ID: `{provider.id}`\n\n"
                        f"### Current State\n```\n{format_tree(tree)}\n```\n\n"
                        f"### Available Actions ({len(tool_set.tools)})\n{actions_text}"
                    ),
                }
            ]
        )

    async def disconnect_app(self, app: str) -> ToolResult:
        if not self.service.disconnect(app):
            return ToolResult(
                content=[
                    {
                        "type": "text",
                        "text": f'App "{app}" is not connected. Use list_apps to see available apps.',
                    }
                ],
                is_error=True,
            )

        return ToolResult(
            content=[
                {
                    "type": "text",
                    "text": f'Disconnected from "{app}". Its tools have been removed.',
                }
            ]
        )


def create_tool_handlers(service: object) -> ToolHandlers:
    """Create the core discovery tool handlers."""
    return ToolHandlers(service=service)
