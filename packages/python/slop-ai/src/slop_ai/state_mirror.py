"""StateMirror — maintains local tree state from snapshots and patches."""

from __future__ import annotations

import copy
from typing import Any

from .types import SlopNode, PatchOp

_NODE_FIELDS = frozenset({"properties", "meta", "affordances", "content_ref"})


def _unescape_pointer(segment: str) -> str:
    return segment.replace("~1", "/").replace("~0", "~")


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
            self._apply_add(segments, op.value, op.index)
        elif op.op == "remove":
            self._apply_remove(segments)
        elif op.op == "replace":
            self._apply_replace(segments, op.value)
        elif op.op == "move":
            self._apply_move(segments, op.index)

    def _apply_move(self, segments: list[str], index: int | None) -> None:
        if index is None or self._is_field_segment(segments):
            return
        child_id = segments[-1]
        parent = self._resolve_node(segments[:-1])
        if parent is None or parent.children is None:
            return
        for i, c in enumerate(parent.children):
            if c.id == child_id:
                child = parent.children.pop(i)
                clamped = max(0, min(index, len(parent.children)))
                parent.children.insert(clamped, child)
                return

    def _navigate(self, segments: list[str]) -> tuple[Any, str] | None:
        """Walk *segments* down the tree, returning (parent, final_key).

        Known field segments (properties, meta, etc.) navigate into those
        fields. All other segments are treated as child IDs.
        """
        current: Any = self._tree
        in_field = False
        i = 0
        while i < len(segments) - 1:
            seg = segments[i]
            if not in_field and seg in _NODE_FIELDS:
                if seg == "meta":
                    current = getattr(current, "meta", None)
                elif seg == "properties":
                    current = getattr(current, "properties", None) if hasattr(current, "properties") else None
                elif seg == "affordances":
                    current = getattr(current, "affordances", None) if hasattr(current, "affordances") else None
                else:
                    current = getattr(current, seg, None)
                if current is None:
                    return None
                in_field = True
            elif in_field:
                key = _unescape_pointer(seg)
                if isinstance(current, dict):
                    current = current.get(key)
                else:
                    current = getattr(current, key, None)
                if current is None:
                    return None
            else:
                # Child ID lookup (node IDs are forbidden from containing / or ~)
                child = _find_child(current, seg)
                if child is None:
                    return None
                current = child
            i += 1
        last = segments[-1]
        return (current, _unescape_pointer(last) if in_field else last)

    def _is_field_segment(self, segments: list[str]) -> bool:
        """Check if the path targets a node field (not a child ID).

        A path is a field mutation if any segment is a reserved field
        keyword — including the terminal segment (e.g. /<node>/affordances).
        See spec/core/messages.md §patch-path-syntax.
        """
        for seg in segments:
            if seg in _NODE_FIELDS:
                return True
        return False

    def _apply_add(self, segments: list[str], value: Any, index: int | None = None) -> None:
        # Adding a child node
        if not self._is_field_segment(segments):
            parent = self._resolve_node(segments[:-1])
            if parent is not None:
                if parent.children is None:
                    parent.children = []
                child = SlopNode.from_dict(value) if isinstance(value, dict) else value
                if index is None:
                    parent.children.append(child)
                else:
                    clamped = max(0, min(index, len(parent.children)))
                    parent.children.insert(clamped, child)
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
        if not self._is_field_segment(segments):
            child_id = segments[-1]
            parent = self._resolve_node(segments[:-1])
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
        # Replacing a child node by ID: the last segment is a child ID under a node.
        if not self._is_field_segment(segments):
            child_id = segments[-1]
            parent = self._resolve_node(segments[:-1])
            if parent is not None and parent.children is not None:
                for i, c in enumerate(parent.children):
                    if c.id == child_id:
                        parent.children[i] = value
                        return
            return

        target = self._navigate(segments)
        if target is not None:
            parent, key = target
            if isinstance(parent, dict):
                parent[key] = value
            else:
                setattr(parent, key, value)

    def _resolve_node(self, segments: list[str]) -> SlopNode | None:
        """Walk segments to find a SlopNode (non-field segments are child IDs)."""
        if not segments:
            return self._tree
        current = self._tree
        for seg in segments:
            if seg in _NODE_FIELDS:
                continue
            child = _find_child(current, seg)
            if child is None:
                return None
            current = child
        return current


def _find_child(node: SlopNode, child_id: str) -> SlopNode | None:
    if node.children is None:
        return None
    for c in node.children:
        if c.id == child_id:
            return c
    return None
