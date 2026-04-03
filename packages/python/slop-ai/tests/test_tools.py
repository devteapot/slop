"""Tests for format_tree matching spec/core/state-tree.md 'Consumer display format'."""

from slop_ai.tools import format_tree
from slop_ai.types import Affordance, NodeMeta, SlopNode


def _canonical_tree() -> SlopNode:
    """Canonical test tree from the spec."""
    return SlopNode(
        id="store",
        type="root",
        properties={"label": "Pet Store"},
        meta=NodeMeta(salience=0.9),
        affordances=[
            Affordance(
                action="search",
                params={
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                },
            ),
        ],
        children=[
            SlopNode(
                id="catalog",
                type="collection",
                properties={"label": "Catalog", "count": 142},
                meta=NodeMeta(
                    total_children=142,
                    window=(0, 25),
                    summary="142 products, 12 on sale",
                ),
                children=[
                    SlopNode(
                        id="prod-1",
                        type="item",
                        properties={
                            "label": "Rubber Duck",
                            "price": 4.99,
                            "in_stock": True,
                        },
                        affordances=[
                            Affordance(
                                action="add_to_cart",
                                params={
                                    "type": "object",
                                    "properties": {
                                        "quantity": {"type": "number"},
                                    },
                                },
                            ),
                            Affordance(action="view"),
                        ],
                    ),
                ],
            ),
            SlopNode(
                id="cart",
                type="collection",
                properties={"label": "Cart"},
                meta=NodeMeta(total_children=3, summary="3 items, $24.97"),
            ),
        ],
    )


def test_header_shows_id_and_label():
    out = format_tree(_canonical_tree())
    assert "[root] store: Pet Store" in out
    assert "[collection] catalog: Catalog" in out
    assert "[item] prod-1: Rubber Duck" in out


def test_header_id_only_when_no_label():
    node = SlopNode(id="status", type="status", properties={"code": 200})
    out = format_tree(node)
    assert "[status] status" in out


def test_extra_props_exclude_label_and_title():
    out = format_tree(_canonical_tree())
    assert "count=142" in out
    assert "price=" in out
    assert "label=" not in out


def test_meta_summary_quoted():
    out = format_tree(_canonical_tree())
    assert '"142 products, 12 on sale"' in out
    assert '"3 items, $24.97"' in out


def test_meta_salience():
    out = format_tree(_canonical_tree())
    assert "salience=0.9" in out


def test_affordances_inline_with_params():
    out = format_tree(_canonical_tree())
    assert "actions: {search(query: string)}" in out
    assert "add_to_cart(quantity: number)" in out
    assert "view}" in out


def test_windowed_collection():
    out = format_tree(_canonical_tree())
    assert "(showing 1 of 142)" in out


def test_lazy_collection():
    out = format_tree(_canonical_tree())
    assert "(3 children not loaded)" in out


def test_indentation():
    out = format_tree(_canonical_tree())
    lines = out.split("\n")
    # Root at indent 0
    assert lines[0].startswith("[root]")
    # Catalog at indent 1
    catalog_lines = [l for l in lines if "catalog" in l]
    assert any(l.startswith("  [collection]") for l in catalog_lines)
    # prod-1 at indent 2
    prod_lines = [l for l in lines if "prod-1" in l]
    assert any(l.startswith("    [item]") for l in prod_lines)
