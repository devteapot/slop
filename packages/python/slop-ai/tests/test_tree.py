"""Tests for tree assembly."""

from slop_ai.tree import assemble_tree


def test_single_registration():
    tree, handlers = assemble_tree(
        {"inbox": {"type": "group", "props": {"label": "Inbox"}}},
        root_id="app",
        root_name="My App",
    )
    assert tree.id == "app"
    assert tree.type == "root"
    assert tree.properties == {"label": "My App"}
    assert len(tree.children) == 1
    assert tree.children[0].id == "inbox"
    assert tree.children[0].type == "group"


def test_nested_paths():
    tree, _ = assemble_tree(
        {
            "inbox": {"type": "group"},
            "inbox/messages": {"type": "collection", "props": {"count": 5}},
        },
        root_id="app",
        root_name="App",
    )
    assert len(tree.children) == 1
    inbox = tree.children[0]
    assert inbox.id == "inbox"
    assert len(inbox.children) == 1
    assert inbox.children[0].id == "messages"
    assert inbox.children[0].properties == {"count": 5}


def test_synthetic_placeholders():
    """Missing ancestors should be created as synthetic group nodes."""
    tree, _ = assemble_tree(
        {"a/b/c": {"type": "item", "props": {"x": 1}}},
        root_id="root",
        root_name="Root",
    )
    assert len(tree.children) == 1
    a = tree.children[0]
    assert a.id == "a"
    assert a.type == "group"  # synthetic
    assert a.properties is None  # synthetic has no properties
    assert len(a.children) == 1

    b = a.children[0]
    assert b.id == "b"
    assert b.type == "group"  # synthetic

    c = b.children[0]
    assert c.id == "c"
    assert c.type == "item"
    assert c.properties == {"x": 1}


def test_synthetic_replaced_by_real():
    """If a real registration exists for a path that was synthetic, use the real one."""
    tree, _ = assemble_tree(
        {
            "a/b": {"type": "item"},
            "a": {"type": "view", "props": {"label": "A"}},
        },
        root_id="root",
        root_name="Root",
    )
    a = tree.children[0]
    assert a.id == "a"
    assert a.type == "view"
    assert a.properties == {"label": "A"}
    assert len(a.children) == 1
    assert a.children[0].id == "b"


def test_multiple_top_level():
    tree, _ = assemble_tree(
        {
            "inbox": {"type": "group"},
            "settings": {"type": "group"},
            "profile": {"type": "group"},
        },
        root_id="app",
        root_name="App",
    )
    assert len(tree.children) == 3
    ids = {c.id for c in tree.children}
    assert ids == {"inbox", "settings", "profile"}


def test_handlers_collected():
    tree, handlers = assemble_tree(
        {
            "todos": {
                "type": "collection",
                "items": [
                    {
                        "id": "t1",
                        "actions": {"toggle": lambda p: None},
                    },
                ],
                "actions": {"create": lambda p: None},
            },
        },
        root_id="app",
        root_name="App",
    )
    assert "todos/create" in handlers
    assert "todos/t1/toggle" in handlers


def test_deep_nesting():
    tree, _ = assemble_tree(
        {
            "a": {"type": "group"},
            "a/b": {"type": "group"},
            "a/b/c": {"type": "group"},
            "a/b/c/d": {"type": "item", "props": {"deep": True}},
        },
        root_id="root",
        root_name="Root",
    )
    node = tree.children[0]  # a
    assert node.id == "a"
    node = node.children[0]  # b
    assert node.id == "b"
    node = node.children[0]  # c
    assert node.id == "c"
    node = node.children[0]  # d
    assert node.id == "d"
    assert node.properties == {"deep": True}
