"""Normalize developer-friendly dict descriptors into wire-format SlopNodes.

Developer descriptors use plain dicts with keys like ``props``, ``actions``,
``items``, ``children``.  This module converts them into proper ``SlopNode``
instances and extracts a flat ``{path/action: handler}`` map.
"""

from __future__ import annotations

from typing import Any, Callable

from .types import Affordance, ContentRef, NodeMeta, SlopNode


ActionHandler = Callable[..., Any]


def normalize_descriptor(
    path: str,
    node_id: str,
    descriptor: dict[str, Any],
) -> tuple[SlopNode, dict[str, ActionHandler]]:
    """Convert a descriptor dict into a ``SlopNode`` and handler map."""
    handlers: dict[str, ActionHandler] = {}
    children: list[SlopNode] = []

    # Build meta
    meta_dict: dict[str, Any] = dict(descriptor.get("meta") or {})
    if "summary" in descriptor:
        meta_dict["summary"] = descriptor["summary"]

    # Windowed collection
    window_desc = descriptor.get("window")
    if window_desc is not None:
        for item in window_desc["items"]:
            item_path = f"{path}/{item['id']}" if path else item["id"]
            item_node, item_handlers = _normalize_item(item_path, item)
            children.append(item_node)
            handlers.update(item_handlers)
        meta_dict["total_children"] = window_desc["total"]
        meta_dict["window"] = (window_desc["offset"], len(window_desc["items"]))
    elif "items" in descriptor and descriptor["items"] is not None:
        for item in descriptor["items"]:
            item_path = f"{path}/{item['id']}" if path else item["id"]
            item_node, item_handlers = _normalize_item(item_path, item)
            children.append(item_node)
            handlers.update(item_handlers)

    # Inline children (recursive)
    inline_children = descriptor.get("children")
    if inline_children:
        for child_id, child_desc in inline_children.items():
            child_path = f"{path}/{child_id}" if path else child_id
            child_node, child_handlers = normalize_descriptor(child_path, child_id, child_desc)
            children.append(child_node)
            handlers.update(child_handlers)

    # Actions → affordances + handlers
    affordances = _normalize_actions(path, descriptor.get("actions"), handlers)

    # Properties
    props = descriptor.get("props")
    properties = dict(props) if props else None

    # Content ref as top-level field (per spec 13)
    cr: ContentRef | None = None
    cr_raw = descriptor.get("content_ref") or descriptor.get("contentRef")
    if cr_raw:
        ref = dict(cr_raw)
        if "uri" not in ref:
            ref["uri"] = f"slop://content/{path}"
        cr = ContentRef.from_dict(ref)

    meta = NodeMeta.from_dict(meta_dict) if meta_dict else None

    node = SlopNode(
        id=node_id,
        type=descriptor["type"],
        properties=properties or None,
        children=children or None,
        affordances=affordances or None,
        meta=meta,
        content_ref=cr,
    )
    return node, handlers


def _normalize_item(
    path: str,
    item: dict[str, Any],
) -> tuple[SlopNode, dict[str, ActionHandler]]:
    """Convert an item descriptor dict into a SlopNode."""
    handlers: dict[str, ActionHandler] = {}
    children: list[SlopNode] = []

    # Item inline children
    inline_children = item.get("children")
    if inline_children:
        for child_id, child_desc in inline_children.items():
            child_path = f"{path}/{child_id}"
            child_node, child_handlers = normalize_descriptor(child_path, child_id, child_desc)
            children.append(child_node)
            handlers.update(child_handlers)

    affordances = _normalize_actions(path, item.get("actions"), handlers)

    meta_dict: dict[str, Any] = dict(item.get("meta") or {})
    if "summary" in item:
        meta_dict["summary"] = item["summary"]
    meta = NodeMeta.from_dict(meta_dict) if meta_dict else None

    node = SlopNode(
        id=item["id"],
        type="item",
        properties=item.get("props") or None,
        children=children or None,
        affordances=affordances or None,
        meta=meta,
    )
    return node, handlers


def _normalize_actions(
    path: str,
    actions: dict[str, Any] | None,
    handlers: dict[str, ActionHandler],
) -> list[Affordance]:
    """Convert an actions dict into a list of Affordances, populating handlers."""
    if not actions:
        return []

    affordances: list[Affordance] = []
    for name, action in actions.items():
        handler_key = f"{path}/{name}" if path else name

        if callable(action):
            handlers[handler_key] = action
            affordances.append(Affordance(action=name))
        else:
            # Dict-style action descriptor
            handlers[handler_key] = action["handler"]
            affordances.append(Affordance(
                action=name,
                label=action.get("label"),
                description=action.get("description"),
                dangerous=action.get("dangerous", False),
                idempotent=action.get("idempotent", False),
                estimate=action.get("estimate"),
                params=_normalize_params(action["params"]) if "params" in action else None,
            ))

    return affordances


def _normalize_params(params: dict[str, Any]) -> dict[str, Any]:
    """Convert simplified params ``{"title": "string"}`` into JSON Schema."""
    properties: dict[str, Any] = {}
    required: list[str] = []

    for key, defn in params.items():
        if isinstance(defn, str):
            properties[key] = {"type": defn}
        else:
            prop: dict[str, Any] = {"type": defn["type"]}
            if "description" in defn:
                prop["description"] = defn["description"]
            if "enum" in defn:
                prop["enum"] = defn["enum"]
            properties[key] = prop
        required.append(key)

    return {"type": "object", "properties": properties, "required": required}
