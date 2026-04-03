"""Tests for tree diffing."""

from slop_ai.types import SlopNode, Affordance, NodeMeta
from slop_ai.diff import diff_nodes


def test_no_changes():
    node = SlopNode(id="x", type="group", properties={"a": 1})
    ops = diff_nodes(node, node)
    assert ops == []


def test_property_added():
    old = SlopNode(id="x", type="group", properties={"a": 1})
    new = SlopNode(id="x", type="group", properties={"a": 1, "b": 2})
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "add"
    assert ops[0].path == "/properties/b"
    assert ops[0].value == 2


def test_property_removed():
    old = SlopNode(id="x", type="group", properties={"a": 1, "b": 2})
    new = SlopNode(id="x", type="group", properties={"a": 1})
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "remove"
    assert ops[0].path == "/properties/b"


def test_property_changed():
    old = SlopNode(id="x", type="group", properties={"a": 1})
    new = SlopNode(id="x", type="group", properties={"a": 2})
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "replace"
    assert ops[0].path == "/properties/a"
    assert ops[0].value == 2


def test_child_added():
    old = SlopNode(id="x", type="group", children=[])
    child = SlopNode(id="c1", type="item", properties={"v": 1})
    new = SlopNode(id="x", type="group", children=[child])
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "add"
    assert ops[0].path == "/c1"


def test_child_removed():
    child = SlopNode(id="c1", type="item")
    old = SlopNode(id="x", type="group", children=[child])
    new = SlopNode(id="x", type="group", children=[])
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "remove"
    assert ops[0].path == "/c1"


def test_child_property_changed():
    old_child = SlopNode(id="c1", type="item", properties={"v": 1})
    new_child = SlopNode(id="c1", type="item", properties={"v": 2})
    old = SlopNode(id="x", type="group", children=[old_child])
    new = SlopNode(id="x", type="group", children=[new_child])
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "replace"
    assert ops[0].path == "/c1/properties/v"


def test_affordances_changed():
    old = SlopNode(id="x", type="group", affordances=[
        Affordance(action="open"),
    ])
    new = SlopNode(id="x", type="group", affordances=[
        Affordance(action="open"),
        Affordance(action="delete", dangerous=True),
    ])
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "replace"
    assert ops[0].path == "/affordances"


def test_meta_changed():
    old = SlopNode(id="x", type="group", meta=NodeMeta(salience=0.5))
    new = SlopNode(id="x", type="group", meta=NodeMeta(salience=0.9))
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "replace"
    assert ops[0].path == "/meta"


def test_meta_added():
    old = SlopNode(id="x", type="group")
    new = SlopNode(id="x", type="group", meta=NodeMeta(summary="hello"))
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].op == "add"
    assert ops[0].path == "/meta"


def test_nested_diff():
    """Changes deep in the tree produce correct paths."""
    old = SlopNode(id="root", type="root", children=[
        SlopNode(id="a", type="group", children=[
            SlopNode(id="b", type="item", properties={"x": 1}),
        ]),
    ])
    new = SlopNode(id="root", type="root", children=[
        SlopNode(id="a", type="group", children=[
            SlopNode(id="b", type="item", properties={"x": 2}),
        ]),
    ])
    ops = diff_nodes(old, new)
    assert len(ops) == 1
    assert ops[0].path == "/a/b/properties/x"
    assert ops[0].value == 2


def test_multiple_changes():
    old = SlopNode(id="x", type="group", properties={"a": 1, "b": 2}, children=[
        SlopNode(id="c1", type="item"),
    ])
    new = SlopNode(id="x", type="group", properties={"a": 3}, children=[
        SlopNode(id="c1", type="item"),
        SlopNode(id="c2", type="item"),
    ])
    ops = diff_nodes(old, new)
    op_summaries = [(o.op, o.path) for o in ops]
    assert ("replace", "/properties/a") in op_summaries
    assert ("remove", "/properties/b") in op_summaries
    assert ("add", "/c2") in op_summaries
