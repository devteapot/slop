from __future__ import annotations

from slop_ai.discovery import ProviderDescriptor
from slop_ai.discovery.models import TransportDescriptor
from slop_ai.types import Affordance, NodeMeta, SlopNode
from slop_hermes.render import render_state_context


def test_render_state_context_shows_connected_and_available_apps() -> None:
    tree = SlopNode(
        id="kanban",
        type="root",
        properties={"label": "Kanban Board"},
        children=[
            SlopNode(
                id="cards",
                type="collection",
                meta=NodeMeta(summary="2 cards"),
                children=[
                    SlopNode(
                        id="card-1",
                        type="item",
                        properties={"label": "Ship Hermes plugin"},
                        affordances=[Affordance(action="done")],
                    )
                ],
            )
        ],
        affordances=[Affordance(action="add_card")],
    )
    service = _FakeService(
        providers=[_FakeProvider("kanban", "Kanban", tree)],
        discovered=[
            _descriptor("kanban", "Kanban", "unix", source="local"),
            _descriptor("calendar", "Calendar", "ws", source="bridge"),
        ],
    )

    rendered = render_state_context(service, max_nodes=32)

    assert rendered is not None
    assert "## SLOP Apps" in rendered
    assert "1 app(s) connected." in rendered
    assert "### Kanban (kanban)" in rendered
    assert "add_card" in rendered
    assert "### Available (not connected)" in rendered
    assert "**Calendar** (id: `calendar`, ws, bridge)" in rendered


def test_render_state_context_returns_none_when_empty() -> None:
    service = _FakeService(providers=[], discovered=[])
    assert render_state_context(service) is None


class _FakeService:
    def __init__(self, *, providers, discovered) -> None:
        self._providers = providers
        self._discovered = discovered

    def get_providers(self):
        return list(self._providers)

    def get_discovered(self):
        return list(self._discovered)


class _FakeProvider:
    def __init__(self, provider_id: str, name: str, tree: SlopNode | None) -> None:
        self.id = provider_id
        self.name = name
        self.subscription_id = "sub-1"
        self.consumer = _FakeConsumer(tree)


class _FakeConsumer:
    def __init__(self, tree: SlopNode | None) -> None:
        self._tree = tree

    def get_tree(self, subscription_id: str) -> SlopNode | None:
        assert subscription_id == "sub-1"
        return self._tree


def _descriptor(
    provider_id: str,
    name: str,
    transport_type: str,
    *,
    source: str,
) -> ProviderDescriptor:
    return ProviderDescriptor(
        id=provider_id,
        name=name,
        slop_version="0.1",
        transport=TransportDescriptor(type=transport_type),
        capabilities=["state", "affordances"],
        source=source,
    )
