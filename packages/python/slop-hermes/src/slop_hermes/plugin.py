"""Hermes plugin registration for SLOP app control."""

from __future__ import annotations

import json
import logging
from typing import Any

from .actions import ActionResult
from .runtime import get_runtime

logger = logging.getLogger(__name__)

_TOOLSET = "slop"

_EMPTY_PARAMS = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}


def register(ctx: Any) -> None:
    """Register tools and hooks with Hermes."""
    runtime = get_runtime()

    ctx.register_tool(
        name="list_apps",
        toolset=_TOOLSET,
        schema={
            "name": "list_apps",
            "description": "List the applications currently available on this computer and whether they are already connected.",
            "parameters": _EMPTY_PARAMS,
        },
        handler=lambda _args, **_kwargs: _serialize_tool_result(runtime.list_apps()),
    )

    ctx.register_tool(
        name="connect_app",
        toolset=_TOOLSET,
        schema={
            "name": "connect_app",
            "description": (
                "Connect to an application and see its full state tree and every action you can perform. "
                "State for already-connected apps is injected into context automatically - "
                "use this to connect a new app or refresh detailed state."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name or ID to connect and inspect.",
                    }
                },
                "required": ["app"],
                "additionalProperties": False,
            },
        },
        handler=lambda args, **_kwargs: _serialize_tool_result(
            runtime.connect_app(str(args.get("app") or ""))
        ),
    )

    ctx.register_tool(
        name="disconnect_app",
        toolset=_TOOLSET,
        schema={
            "name": "disconnect_app",
            "description": "Disconnect from an application. Stops state updates. Use when you're done interacting with an app.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name or ID to disconnect from.",
                    }
                },
                "required": ["app"],
                "additionalProperties": False,
            },
        },
        handler=lambda args, **_kwargs: _serialize_tool_result(
            runtime.disconnect_app(str(args.get("app") or ""))
        ),
    )

    ctx.register_tool(
        name="app_action",
        toolset=_TOOLSET,
        schema={
            "name": "app_action",
            "description": (
                "Perform an action on an application - add items, edit content, toggle state, "
                "delete entries, move things around, start or stop processes, and more. "
                "Use the exact paths, action names, and parameter values from the application state shown in context."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name or ID (from connect_app or context)",
                    },
                    "path": {
                        "type": "string",
                        "description": "Path to the item to act on, e.g. '/' or '/todos/todo-1'",
                    },
                    "action": {
                        "type": "string",
                        "description": "Action to perform, e.g. 'add_card', 'toggle', 'delete'",
                    },
                    "params": {
                        "type": "object",
                        "description": "Action parameters as key-value pairs",
                        "additionalProperties": True,
                    },
                },
                "required": ["app", "path", "action"],
                "additionalProperties": False,
            },
        },
        handler=lambda args, **_kwargs: _serialize_action_result(
            runtime.app_action(
                app=str(args.get("app") or ""),
                path=str(args.get("path") or "/"),
                action=str(args.get("action") or ""),
                params=args.get("params")
                if isinstance(args.get("params"), dict)
                else None,
            )
        ),
    )

    ctx.register_tool(
        name="app_action_batch",
        toolset=_TOOLSET,
        schema={
            "name": "app_action_batch",
            "description": (
                "Perform multiple actions on an application in a single call. Much faster than calling app_action repeatedly. "
                "Use this when you need to add multiple items, make several changes, or perform any repeated sequence of actions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name or ID (from connect_app or context)",
                    },
                    "actions": {
                        "type": "array",
                        "description": "Array of actions to perform sequentially",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Path to act on",
                                },
                                "action": {
                                    "type": "string",
                                    "description": "Action to perform",
                                },
                                "params": {
                                    "type": "object",
                                    "description": "Action parameters",
                                    "additionalProperties": True,
                                },
                            },
                            "required": ["path", "action"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["app", "actions"],
                "additionalProperties": False,
            },
        },
        handler=lambda args, **_kwargs: _serialize_action_result(
            runtime.app_action_batch(
                app=str(args.get("app") or ""),
                actions=args.get("actions")
                if isinstance(args.get("actions"), list)
                else [],
            )
        ),
    )

    ctx.register_hook("on_session_start", _warm_runtime)
    ctx.register_hook("pre_llm_call", _inject_context)


def _warm_runtime(**_kwargs: Any) -> None:
    try:
        get_runtime().ensure_started()
    except Exception:
        logger.warning("Failed to start SLOP Hermes runtime", exc_info=True)


def _inject_context(**_kwargs: Any) -> dict[str, str] | None:
    try:
        context = get_runtime().build_context()
    except Exception:
        logger.warning("Failed to build SLOP context for Hermes", exc_info=True)
        return None
    if not context:
        return None
    return {"context": context}


def _serialize_tool_result(result: Any) -> str:
    text = _tool_result_text(result)
    if getattr(result, "is_error", False):
        return json.dumps({"error": text}, ensure_ascii=False)
    return json.dumps({"result": text}, ensure_ascii=False)


def _serialize_action_result(result: ActionResult) -> str:
    if result.is_error:
        return json.dumps({"error": result.text}, ensure_ascii=False)
    return json.dumps({"result": result.text}, ensure_ascii=False)


def _tool_result_text(result: Any) -> str:
    parts: list[str] = []
    for block in getattr(result, "content", []):
        text = block.get("text") if isinstance(block, dict) else None
        if isinstance(text, str) and text:
            parts.append(text)
    return "\n".join(parts)
