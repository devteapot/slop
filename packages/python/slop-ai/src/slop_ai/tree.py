"""Assemble a hierarchical SLOP tree from flat path-based registrations.

Paths encode hierarchy: ``"inbox/messages"`` becomes a child of ``"inbox"``.
Missing ancestors are created as synthetic placeholder nodes.
"""

from __future__ import annotations

from typing import Any, Callable

from .descriptor import ActionHandler, normalize_descriptor
from .types import SlopNode


def assemble_tree(
    registrations: dict[str, dict[str, Any]],
    root_id: str,
    root_name: str,
) -> tuple[SlopNode, dict[str, ActionHandler]]:
    """Build a hierarchical ``SlopNode`` tree from flat registrations.

    Returns ``(tree, handlers)`` where *handlers* maps
    ``"path/action"`` → callable.
    """
    all_handlers: dict[str, ActionHandler] = {}
    nodes_by_path: dict[str, SlopNode] = {}

    # Sort by depth (shallowest first), then alphabetically
    sorted_paths = sorted(
        registrations.keys(),
        key=lambda p: (p.count("/"), p),
    )

    # Normalize each registration
    for path in sorted_paths:
        descriptor = registrations[path]
        node_id = path.rsplit("/", 1)[-1]
        node, handlers = normalize_descriptor(path, node_id, descriptor)
        nodes_by_path[path] = node
        all_handlers.update(handlers)

    # Root
    root = SlopNode(
        id=root_id,
        type="root",
        properties={"label": root_name},
        children=[],
    )

    # Attach each node to its parent
    for path in sorted_paths:
        node = nodes_by_path[path]
        parent_path = _parent_path(path)

        if parent_path == "":
            _add_child(root, node)
        else:
            parent = _ensure_node(parent_path, nodes_by_path, root)
            _add_child(parent, node)

    return root, all_handlers


def _parent_path(path: str) -> str:
    idx = path.rfind("/")
    return "" if idx == -1 else path[:idx]


def _ensure_node(
    path: str,
    nodes_by_path: dict[str, SlopNode],
    root: SlopNode,
) -> SlopNode:
    """Return the node at *path*, creating synthetic placeholders as needed."""
    existing = nodes_by_path.get(path)
    if existing is not None:
        return existing

    node_id = path.rsplit("/", 1)[-1]
    synthetic = SlopNode(id=node_id, type="group", children=[])
    nodes_by_path[path] = synthetic

    parent_path = _parent_path(path)
    if parent_path == "":
        _add_child(root, synthetic)
    else:
        parent = _ensure_node(parent_path, nodes_by_path, root)
        _add_child(parent, synthetic)

    return synthetic


def _add_child(parent: SlopNode, child: SlopNode) -> None:
    """Add *child* to *parent*, replacing any existing child with the same id."""
    if parent.children is None:
        parent.children = []

    for i, existing in enumerate(parent.children):
        if existing.id == child.id:
            # If existing was a synthetic placeholder, transfer its children
            if existing.type == "group" and existing.properties is None:
                if existing.children and not child.children:
                    child.children = existing.children
                elif existing.children and child.children:
                    child_ids = {c.id for c in child.children}
                    for ec in existing.children:
                        if ec.id not in child_ids:
                            child.children.append(ec)
            parent.children[i] = child
            return

    parent.children.append(child)
