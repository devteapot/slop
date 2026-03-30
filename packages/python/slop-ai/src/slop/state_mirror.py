"""StateMirror — maintains local tree state from snapshots and patches."""

from __future__ import annotations

import copy
from typing import Any

from .types import SlopNode, PatchOp


class StateMirror:
    """Mirrors a remote SLOP tree, applying snapshot and patch messages."""

    def __init__(self, snapshot: dict[str, Any]) -> None:
        self._tree = SlopNode.from_dict(copy.deepcopy(snapshot["tree"]))
        self._version: int = snapshot["version"]

    def apply_patch(self, patch: dict[str, Any]) -> None:
        """Apply a patch message (list of ops) to the local tree."""
        for op_data in patch["ops"]:
            op = PatchOp.from_dict(op_data) if isinstance(op_data, dict) else op_data
            self._apply_op(op)
        self._version = patch["version"]

    def get_tree(self) -> SlopNode:
        return self._tree

    def get_version(self) -> int:
        return self._version

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _apply_op(self, op: PatchOp) -> None:
        segments = [s for s in op.path.split("/") if s]
        if not segments:
            return
        if op.op == "add":
            self._apply_add(segments, op.value)
        elif op.op == "remove":
            self._apply_remove(segments)
        elif op.op == "replace":
            self._apply_replace(segments, op.value)

    def _navigate(self, segments: list[str]) -> tuple[Any, str] | None:
        """Walk *segments* down the tree, returning (parent, final_key).

        ``children`` segments resolve by child ID, not array index.
        ``meta`` navigates into a dataclass (attribute access).
        ``properties`` navigates into a dict (key access).
        """
        current: Any = self._tree
        i = 0
        while i < len(segments) - 1:
            seg = segments[i]
            if seg == "children":
                child_id = segments[i + 1]
                child = _find_child(current, child_id)
                if child is None:
                    return None
                current = child
                i += 2
            elif seg == "meta":
                current = getattr(current, "meta", None)
                if current is None:
                    return None
                i += 1
            elif seg == "properties":
                current = getattr(current, "properties", None) if hasattr(current, "properties") else None
                if current is None:
                    return None
                i += 1
            elif seg == "affordances":
                current = getattr(current, "affordances", None) if hasattr(current, "affordances") else None
                if current is None:
                    return None
                i += 1
            else:
                # generic attribute / key access
                if isinstance(current, dict):
                    current = current.get(seg)
                else:
                    current = getattr(current, seg, None)
                if current is None:
                    return None
                i += 1
        return (current, segments[-1])

    def _apply_add(self, segments: list[str], value: Any) -> None:
        # Adding a child node
        if len(segments) >= 2 and segments[-2] == "children":
            parent = self._resolve_node(segments[:-2])
            if parent is not None:
                if parent.children is None:
                    parent.children = []
                child = SlopNode.from_dict(value) if isinstance(value, dict) else value
                parent.children.append(child)
            return

        target = self._navigate(segments)
        if target is not None:
            parent, key = target
            if isinstance(parent, dict):
                parent[key] = value
            else:
                setattr(parent, key, value)

    def _apply_remove(self, segments: list[str]) -> None:
        # Removing a child node by ID
        if len(segments) >= 2 and segments[-2] == "children":
            child_id = segments[-1]
            parent = self._resolve_node(segments[:-2])
            if parent is not None and parent.children is not None:
                parent.children = [c for c in parent.children if c.id != child_id]
            return

        target = self._navigate(segments)
        if target is not None:
            parent, key = target
            if isinstance(parent, dict):
                parent.pop(key, None)
            else:
                setattr(parent, key, None)

    def _apply_replace(self, segments: list[str], value: Any) -> None:
        target = self._navigate(segments)
        if target is not None:
            parent, key = target
            if isinstance(parent, dict):
                parent[key] = value
            else:
                setattr(parent, key, value)

    def _resolve_node(self, segments: list[str]) -> SlopNode | None:
        """Walk segments to find a SlopNode (only ``children`` hops)."""
        if not segments:
            return self._tree
        current = self._tree
        i = 0
        while i < len(segments):
            if segments[i] == "children":
                if i + 1 >= len(segments):
                    return None
                child = _find_child(current, segments[i + 1])
                if child is None:
                    return None
                current = child
                i += 2
            else:
                i += 1
        return current


def _find_child(node: SlopNode, child_id: str) -> SlopNode | None:
    if node.children is None:
        return None
    for c in node.children:
        if c.id == child_id:
            return c
    return None
