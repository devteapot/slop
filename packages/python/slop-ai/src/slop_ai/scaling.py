"""Tree scaling utilities: depth truncation, node-budget compaction,
salience filtering, and subtree extraction.

These operate on wire-format SlopNodes and are used by providers
to respect consumer token budgets.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from .types import NodeMeta, SlopNode


@dataclass
class OutputTreeOptions:
    """Options for preparing a tree for output to a consumer."""

    max_depth: int | None = None
    max_nodes: int | None = None
    min_salience: float | None = None
    types: list[str] | None = None


def prepare_tree(root: SlopNode, options: OutputTreeOptions) -> SlopNode:
    """Prepare a tree for output by applying filter → truncate → compact."""
    tree = root
    if options.min_salience is not None or options.types is not None:
        tree = filter_tree(tree, options.min_salience, options.types)
    if options.max_depth is not None:
        tree = truncate_tree(tree, options.max_depth)
    if options.max_nodes is not None:
        tree = auto_compact(tree, options.max_nodes)
    return tree


def get_subtree(root: SlopNode, path: str) -> SlopNode | None:
    """Extract a subtree by slash-separated node ID path (e.g. '/inbox/msg-42')."""
    if not path or path == "/":
        return root

    segments = [s for s in path.strip("/").split("/") if s]
    current = root
    for seg in segments:
        if not current.children:
            return None
        found = None
        for child in current.children:
            if child.id == seg:
                found = child
                break
        if found is None:
            return None
        current = found
    return current


def truncate_tree(node: SlopNode, depth: int) -> SlopNode:
    """Collapse nodes beyond depth to stubs with meta.total_children."""
    if depth <= 0 and node.children:
        meta = copy.copy(node.meta) if node.meta else NodeMeta()
        meta.total_children = len(node.children)
        return SlopNode(
            id=node.id,
            type=node.type,
            properties=node.properties,
            meta=meta,
        )
    if not node.children:
        return node
    return SlopNode(
        id=node.id,
        type=node.type,
        properties=node.properties,
        children=[truncate_tree(c, depth - 1) for c in node.children],
        affordances=node.affordances,
        meta=node.meta,
    )


def auto_compact(root: SlopNode, max_nodes: int) -> SlopNode:
    """Collapse lowest-salience subtrees to fit within a node budget.

    Preserves root children and pinned nodes.
    """
    total = count_nodes(root)
    if total <= max_nodes:
        return root

    candidates: list[_CompactCandidate] = []
    if root.children:
        for i, child in enumerate(root.children):
            _collect_candidates(child, [i], candidates, is_root_child=False)

    candidates.sort(key=lambda c: c.score)

    tree = copy.deepcopy(root)
    node_count = total

    for candidate in candidates:
        if node_count <= max_nodes:
            break
        saved = _collapse_at_path(tree, candidate.path)
        node_count -= saved

    return tree


def filter_tree(
    node: SlopNode,
    min_salience: float | None = None,
    types: list[str] | None = None,
) -> SlopNode:
    """Filter a tree by salience threshold and/or node types.

    The root node is never filtered.
    """
    if not node.children:
        return node

    filtered: list[SlopNode] = []
    for child in node.children:
        if min_salience is not None:
            salience = child.meta.salience if child.meta and child.meta.salience is not None else 0.5
            if salience < min_salience:
                continue
        if types is not None and child.type not in types:
            continue
        filtered.append(filter_tree(child, min_salience, types))

    return SlopNode(
        id=node.id,
        type=node.type,
        properties=node.properties,
        children=filtered if filtered else None,
        affordances=node.affordances,
        meta=node.meta,
    )


def count_nodes(node: SlopNode) -> int:
    """Count total nodes in a tree."""
    return 1 + sum(count_nodes(c) for c in (node.children or []))


# --- Internal helpers ---


@dataclass
class _CompactCandidate:
    path: list[int]
    score: float
    child_count: int


def _collect_candidates(
    node: SlopNode,
    path: list[int],
    candidates: list[_CompactCandidate],
    is_root_child: bool = False,
) -> None:
    if not node.children:
        return
    for i, child in enumerate(node.children):
        child_path = path + [i]

        if (
            child.children
            and not is_root_child
            and not (child.meta and child.meta.pinned)
        ):
            child_count = count_nodes(child) - 1
            salience = child.meta.salience if child.meta and child.meta.salience is not None else 0.5
            depth = len(child_path)
            score = salience - depth * 0.01 - child_count * 0.001
            candidates.append(_CompactCandidate(path=child_path, score=score, child_count=child_count))

        _collect_candidates(child, child_path, candidates, is_root_child=False)


def _collapse_at_path(tree: SlopNode, path: list[int]) -> int:
    node = tree
    for i in range(len(path) - 1):
        if not node.children or path[i] >= len(node.children):
            return 0
        node = node.children[path[i]]

    idx = path[-1]
    if not node.children or idx >= len(node.children):
        return 0

    target = node.children[idx]
    saved = count_nodes(target) - 1

    meta = copy.copy(target.meta) if target.meta else NodeMeta()
    meta.total_children = len(target.children) if target.children else 0
    if not meta.summary:
        meta.summary = f"{len(target.children) if target.children else 0} children"

    node.children[idx] = SlopNode(
        id=target.id,
        type=target.type,
        properties=target.properties,
        affordances=target.affordances,
        meta=meta,
    )

    return saved
