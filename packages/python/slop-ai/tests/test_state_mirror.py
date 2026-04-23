"""StateMirror conformance tests — field-vs-child patch-path routing.

Covers the cross-SDK contract from spec/core/messages.md §patch-path-syntax:
reserved field keywords (`properties`, `meta`, `affordances`, `content_ref`)
take precedence over child-id resolution.
"""

from __future__ import annotations

from slop_ai.state_mirror import StateMirror


def _snapshot() -> dict:
    return {
        "version": 1,
        "tree": {
            "id": "root",
            "type": "root",
            "properties": {"label": "App"},
            "children": [
                {
                    "id": "todos",
                    "type": "collection",
                    "children": [
                        {"id": "t1", "type": "item", "properties": {"done": False}},
                    ],
                }
            ],
        },
    }


def test_add_affordances_field_routes_to_field_not_children() -> None:
    mirror = StateMirror(_snapshot())
    mirror.apply_patch(
        {
            "version": 2,
            "ops": [
                {
                    "op": "add",
                    "path": "/todos/t1/affordances",
                    "value": [{"action": "cancel"}],
                }
            ],
        }
    )
    t1 = mirror.get_tree().children[0].children[0]
    assert t1.affordances is not None and len(t1.affordances) == 1
    # Must not have been pushed into children as a pseudo-child node.
    assert not (t1.children or [])


def test_add_meta_field_routes_to_field_not_children() -> None:
    mirror = StateMirror(_snapshot())
    mirror.apply_patch(
        {
            "version": 2,
            "ops": [
                {"op": "add", "path": "/todos/t1/meta", "value": {"summary": "done"}}
            ],
        }
    )
    t1 = mirror.get_tree().children[0].children[0]
    assert t1.meta is not None
    assert not (t1.children or [])


def test_nested_property_path_routes_into_properties() -> None:
    # Regression: isFieldSegment must scan all segments, not just the last —
    # otherwise /<node>/properties/<nested>/<key> is mis-routed as a child op.
    mirror = StateMirror(_snapshot())
    mirror.apply_patch(
        {
            "version": 2,
            "ops": [
                {
                    "op": "replace",
                    "path": "/todos/t1/properties/done",
                    "value": True,
                }
            ],
        }
    )
    t1 = mirror.get_tree().children[0].children[0]
    assert t1.properties["done"] is True
