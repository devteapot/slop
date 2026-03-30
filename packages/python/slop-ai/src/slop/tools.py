"""LLM tool helpers — convert SLOP affordances to tool-call schemas."""

from __future__ import annotations

import json
from typing import Any, TypedDict

from .types import SlopNode


# ---------------------------------------------------------------
# Types
# ---------------------------------------------------------------

class _FunctionDef(TypedDict):
    name: str
    description: str
    parameters: dict[str, Any]


class LlmTool(TypedDict):
    type: str
    function: _FunctionDef


# ---------------------------------------------------------------
# Affordances -> LLM tools
# ---------------------------------------------------------------

def affordances_to_tools(node: SlopNode, path: str = "") -> list[LlmTool]:
    """Recursively collect affordances from *node* into LLM tool defs."""
    tools: list[LlmTool] = []

    for aff in node.affordances or []:
        tool_name = encode_tool(path or "/", aff.action)
        label = aff.label or aff.action
        desc = f"{label}: {aff.description}" if aff.description else label
        desc += f" (on {path or '/'})"
        if aff.dangerous:
            desc += " [DANGEROUS - confirm first]"

        tools.append(
            LlmTool(
                type="function",
                function=_FunctionDef(
                    name=tool_name,
                    description=desc,
                    parameters=aff.params if aff.params else {"type": "object", "properties": {}},
                ),
            )
        )

    for child in node.children or []:
        tools.extend(affordances_to_tools(child, f"{path}/{child.id}"))

    return tools


# ---------------------------------------------------------------
# Encode / decode tool names
# ---------------------------------------------------------------

def encode_tool(path: str, action: str) -> str:
    """Encode a node path + action into a flat tool name (double-underscore separated)."""
    segments = [s for s in path.split("/") if s]
    return "__".join(["invoke", *segments, action])


def decode_tool(name: str) -> dict[str, str]:
    """Decode a tool name back to ``{"path": ..., "action": ...}``."""
    parts = name.split("__")
    action = parts[-1]
    path_segments = parts[1:-1]
    return {
        "path": "/" + "/".join(path_segments) if path_segments else "/",
        "action": action,
    }


# ---------------------------------------------------------------
# Human-readable tree formatting
# ---------------------------------------------------------------

def format_tree(node: SlopNode, indent: int = 0) -> str:
    """Return a compact, human-readable representation of the tree."""
    pad = "  " * indent
    props = node.properties or {}
    label = props.get("label") or props.get("title") or node.id

    extra = ", ".join(
        f"{k}={json.dumps(v)}"
        for k, v in props.items()
        if k not in ("label", "title")
    )

    affordance_parts: list[str] = []
    for a in node.affordances or []:
        s = a.action
        if a.params and a.params.get("properties"):
            param_str = ", ".join(
                f"{k}: {v.get('type', '?')}"
                for k, v in a.params["properties"].items()
            )
            s += f"({param_str})"
        affordance_parts.append(s)
    affordances = ", ".join(affordance_parts)

    line = f"{pad}[{node.type}] {label}"
    if extra:
        line += f" ({extra})"
    if affordances:
        line += f"  actions: {{{affordances}}}"

    lines = [line]
    for child in node.children or []:
        lines.append(format_tree(child, indent + 1))
    return "\n".join(lines)
