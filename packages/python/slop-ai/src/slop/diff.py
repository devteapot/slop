"""Recursive diff of two SLOP trees producing JSON Patch operations.

Paths in the generated ops use node IDs for children segments (not array
indices), matching the SLOP patch convention.
"""

from __future__ import annotations

import json
from typing import Any

from .types import PatchOp, SlopNode


def diff_nodes(
    old: SlopNode,
    new: SlopNode,
    base_path: str = "",
) -> list[PatchOp]:
    """Recursively diff *old* and *new* and return patch operations."""
    ops: list[PatchOp] = []

    # --- properties ---
    old_props = old.properties or {}
    new_props = new.properties or {}
    all_keys = set(old_props) | set(new_props)
    for key in sorted(all_keys):
        old_val = old_props.get(key)
        new_val = new_props.get(key)
        if old_val is None and new_val is not None:
            ops.append(PatchOp(op="add", path=f"{base_path}/properties/{key}", value=new_val))
        elif old_val is not None and new_val is None:
            ops.append(PatchOp(op="remove", path=f"{base_path}/properties/{key}"))
        elif _json_ne(old_val, new_val):
            ops.append(PatchOp(op="replace", path=f"{base_path}/properties/{key}", value=new_val))

    # --- affordances (replace entire list if changed) ---
    old_aff = [a.to_dict() for a in old.affordances] if old.affordances else None
    new_aff = [a.to_dict() for a in new.affordances] if new.affordances else None
    if _json_ne(old_aff, new_aff):
        if new_aff is not None:
            op = "replace" if old_aff is not None else "add"
            ops.append(PatchOp(op=op, path=f"{base_path}/affordances", value=new_aff))
        elif old_aff is not None:
            ops.append(PatchOp(op="remove", path=f"{base_path}/affordances"))

    # --- meta (replace entire object if changed) ---
    old_meta = old.meta.to_dict() if old.meta else None
    new_meta = new.meta.to_dict() if new.meta else None
    if _json_ne(old_meta, new_meta):
        if new_meta is not None:
            op = "replace" if old_meta is not None else "add"
            ops.append(PatchOp(op=op, path=f"{base_path}/meta", value=new_meta))
        elif old_meta is not None:
            ops.append(PatchOp(op="remove", path=f"{base_path}/meta"))

    # --- children ---
    old_children = old.children or []
    new_children = new.children or []
    old_map = {c.id: c for c in old_children}
    new_map = {c.id: c for c in new_children}

    # Removed
    for child in old_children:
        if child.id not in new_map:
            ops.append(PatchOp(op="remove", path=f"{base_path}/children/{child.id}"))

    # Added
    for child in new_children:
        if child.id not in old_map:
            ops.append(PatchOp(op="add", path=f"{base_path}/children/{child.id}", value=child.to_dict()))

    # Recursively diff shared children
    for child in new_children:
        old_child = old_map.get(child.id)
        if old_child is not None:
            ops.extend(diff_nodes(old_child, child, f"{base_path}/children/{child.id}"))

    return ops


def _json_ne(a: Any, b: Any) -> bool:
    """Return True if *a* and *b* differ when serialized as JSON."""
    if a is b:
        return False
    if a is None or b is None:
        return a is not b
    return json.dumps(a, sort_keys=True) != json.dumps(b, sort_keys=True)
