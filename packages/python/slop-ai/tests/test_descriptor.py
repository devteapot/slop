"""Tests for descriptor normalization."""

from slop.descriptor import normalize_descriptor


def test_simple_descriptor():
    node, handlers = normalize_descriptor("inbox", "inbox", {
        "type": "group",
        "props": {"count": 5, "label": "Inbox"},
    })
    assert node.id == "inbox"
    assert node.type == "group"
    assert node.properties == {"count": 5, "label": "Inbox"}
    assert node.children is None
    assert node.affordances is None
    assert len(handlers) == 0


def test_items_become_children():
    node, handlers = normalize_descriptor("todos", "todos", {
        "type": "collection",
        "props": {"count": 2},
        "items": [
            {"id": "t1", "props": {"title": "Buy milk", "done": False}},
            {"id": "t2", "props": {"title": "Write code", "done": True}},
        ],
    })
    assert node.type == "collection"
    assert len(node.children) == 2
    assert node.children[0].id == "t1"
    assert node.children[0].type == "item"
    assert node.children[0].properties == {"title": "Buy milk", "done": False}
    assert node.children[1].id == "t2"


def test_callable_action():
    called_with = {}

    def handler(params):
        called_with.update(params)

    node, handlers = normalize_descriptor("x", "x", {
        "type": "group",
        "actions": {"do_it": handler},
    })
    assert len(node.affordances) == 1
    assert node.affordances[0].action == "do_it"
    assert "x/do_it" in handlers
    handlers["x/do_it"]({"a": 1})
    assert called_with == {"a": 1}


def test_dict_action_with_params():
    node, handlers = normalize_descriptor("x", "x", {
        "type": "group",
        "actions": {
            "create": {
                "handler": lambda params: None,
                "params": {"title": "string"},
                "label": "Create",
                "dangerous": True,
                "estimate": "fast",
            },
        },
    })
    aff = node.affordances[0]
    assert aff.action == "create"
    assert aff.label == "Create"
    assert aff.dangerous is True
    assert aff.estimate == "fast"
    assert aff.params == {
        "type": "object",
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
    }


def test_inline_children():
    node, handlers = normalize_descriptor("app", "app", {
        "type": "root",
        "children": {
            "sidebar": {"type": "group", "props": {"label": "Sidebar"}},
            "main": {"type": "view", "props": {"label": "Main"}},
        },
    })
    assert len(node.children) == 2
    ids = {c.id for c in node.children}
    assert ids == {"sidebar", "main"}


def test_content_ref():
    node, _ = normalize_descriptor("editor/file", "file", {
        "type": "document",
        "props": {"title": "main.py"},
        "content_ref": {
            "type": "text",
            "mime": "text/python",
            "summary": "Python source file",
        },
    })
    assert node.content_ref is not None
    assert "content_ref" not in (node.properties or {})
    assert node.content_ref.type == "text"
    assert node.content_ref.uri == "slop://content/editor/file"


def test_windowed_collection():
    node, _ = normalize_descriptor("inbox", "inbox", {
        "type": "collection",
        "window": {
            "items": [
                {"id": "m1", "props": {"subject": "Hello"}},
                {"id": "m2", "props": {"subject": "World"}},
            ],
            "total": 100,
            "offset": 0,
        },
    })
    assert len(node.children) == 2
    assert node.meta.total_children == 100
    assert node.meta.window == (0, 2)


def test_item_with_actions():
    node, handlers = normalize_descriptor("todos", "todos", {
        "type": "collection",
        "items": [
            {
                "id": "t1",
                "props": {"title": "Test"},
                "actions": {
                    "toggle": lambda params: None,
                    "delete": {"handler": lambda params: None, "dangerous": True},
                },
            },
        ],
    })
    item = node.children[0]
    assert len(item.affordances) == 2
    action_names = {a.action for a in item.affordances}
    assert action_names == {"toggle", "delete"}
    assert "todos/t1/toggle" in handlers
    assert "todos/t1/delete" in handlers


def test_item_content_ref():
    node, _ = normalize_descriptor("docs", "docs", {
        "type": "collection",
        "items": [
            {
                "id": "readme",
                "props": {"title": "README.md"},
                "content_ref": {
                    "type": "text",
                    "mime": "text/markdown",
                    "summary": "Project readme",
                },
            },
        ],
    })
    item = node.children[0]
    assert item.content_ref is not None
    assert item.content_ref.type == "text"
    assert item.content_ref.mime == "text/markdown"
    assert item.content_ref.uri == "slop://content/docs/readme"


def test_array_params_preserve_items():
    node, _ = normalize_descriptor("x", "x", {
        "type": "group",
        "actions": {
            "tag": {
                "handler": lambda params: None,
                "params": {
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    })
    params = node.affordances[0].params
    assert params["properties"]["tags"]["type"] == "array"
    assert params["properties"]["tags"]["items"] == {"type": "string"}


def test_meta_passthrough():
    node, _ = normalize_descriptor("x", "x", {
        "type": "status",
        "summary": "Everything OK",
        "meta": {"salience": 0.9, "urgency": "high"},
    })
    assert node.meta.summary == "Everything OK"
    assert node.meta.salience == 0.9
    assert node.meta.urgency == "high"
