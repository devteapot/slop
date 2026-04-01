"""LLM tool helpers — convert SLOP affordances to tool-call schemas."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
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


@dataclass
class ToolResolution:
    path: str
    action: str


@dataclass
class ToolSet:
    """Tools and a resolver to map short names back to path + action."""

    tools: list[LlmTool] = field(default_factory=list)
    _resolve_map: dict[str, ToolResolution] = field(default_factory=dict)

    def resolve(self, tool_name: str) -> ToolResolution | None:
        """Map a tool name back to its path and action for invoke messages."""
        return self._resolve_map.get(tool_name)


# ---------------------------------------------------------------
# Affordances -> LLM tools
# ---------------------------------------------------------------

_SANITIZE_RE = re.compile(r"[^a-zA-Z0-9]")


def _sanitize(s: str) -> str:
    return _SANITIZE_RE.sub("_", s)


@dataclass
class _Entry:
    short_name: str
    path: str
    action: str
    ancestors: list[str]
    aff: Any


def affordances_to_tools(node: SlopNode, path: str = "") -> ToolSet:
    """Recursively collect affordances from *node* into a :class:`ToolSet`.

    Tool names use short ``{nodeId}__{action}`` format. Collisions are
    disambiguated by prepending parent IDs.
    """
    entries: list[_Entry] = []
    _collect(node, path, [], entries)

    name_map = _disambiguate(entries)

    ts = ToolSet()
    for entry in entries:
        tool_name = name_map[id(entry)]
        p = entry.path or "/"
        ts._resolve_map[tool_name] = ToolResolution(path=p, action=entry.action)

        label = entry.aff.label or entry.aff.action
        desc = f"{label}: {entry.aff.description}" if entry.aff.description else label
        desc += f" (on {p})"
        if entry.aff.dangerous:
            desc += " [DANGEROUS - confirm first]"

        ts.tools.append(
            LlmTool(
                type="function",
                function=_FunctionDef(
                    name=tool_name,
                    description=desc,
                    parameters=entry.aff.params if entry.aff.params else {"type": "object", "properties": {}},
                ),
            )
        )

    return ts


def _collect(
    node: SlopNode,
    path: str,
    ancestors: list[str],
    out: list[_Entry],
) -> None:
    safe_id = _sanitize(node.id)
    for aff in node.affordances or []:
        safe_action = _sanitize(aff.action)
        out.append(_Entry(
            short_name=f"{safe_id}__{safe_action}",
            path=path or "/",
            action=aff.action,
            ancestors=[_sanitize(a) for a in ancestors],
            aff=aff,
        ))
    for child in node.children or []:
        _collect(child, f"{path}/{child.id}", [*ancestors, node.id], out)


def _disambiguate(entries: list[_Entry]) -> dict[int, str]:
    result: dict[int, str] = {}

    groups: dict[str, list[_Entry]] = {}
    for entry in entries:
        groups.setdefault(entry.short_name, []).append(entry)

    for short_name, group in groups.items():
        if len(group) == 1:
            result[id(group[0])] = short_name
            continue

        for entry in group:
            name = short_name
            for i in range(len(entry.ancestors) - 1, -1, -1):
                name = f"{entry.ancestors[i]}__{name}"
                # Check uniqueness
                others_match = False
                depth = len(entry.ancestors) - 1 - i
                for other in group:
                    if other is entry:
                        continue
                    o_name = other.short_name
                    for j in range(len(other.ancestors) - 1, max(-1, len(other.ancestors) - 2 - depth), -1):
                        o_name = f"{other.ancestors[j]}__{o_name}"
                    if o_name == name:
                        others_match = True
                        break
                if not others_match:
                    break
            result[id(entry)] = name

    return result


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
