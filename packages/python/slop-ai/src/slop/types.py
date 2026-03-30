"""Wire protocol types for the SLOP specification.

These dataclasses represent the on-the-wire JSON format. Developer-facing
descriptor types are plain dicts — see descriptor.py for normalization.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from typing import Any, Literal


@dataclass
class NodeMeta:
    """Attention and structural metadata for a node."""

    summary: str | None = None
    salience: float | None = None
    pinned: bool | None = None
    changed: bool | None = None
    focus: bool | None = None
    urgency: Literal["none", "low", "medium", "high", "critical"] | None = None
    reason: str | None = None
    total_children: int | None = None
    window: tuple[int, int] | None = None
    created: str | None = None
    updated: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        for f in fields(self):
            v = getattr(self, f.name)
            if v is not None:
                d[f.name] = list(v) if f.name == "window" else v
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NodeMeta:
        kw: dict[str, Any] = {}
        for f in fields(cls):
            if f.name in data:
                v = data[f.name]
                if f.name == "window" and isinstance(v, list):
                    v = tuple(v)
                kw[f.name] = v
        return cls(**kw)


@dataclass
class Affordance:
    """An action available on a node."""

    action: str
    label: str | None = None
    description: str | None = None
    params: dict[str, Any] | None = None
    dangerous: bool = False
    idempotent: bool = False
    estimate: Literal["instant", "fast", "slow", "async"] | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"action": self.action}
        if self.label is not None:
            d["label"] = self.label
        if self.description is not None:
            d["description"] = self.description
        if self.params is not None:
            d["params"] = self.params
        if self.dangerous:
            d["dangerous"] = True
        if self.idempotent:
            d["idempotent"] = True
        if self.estimate is not None:
            d["estimate"] = self.estimate
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Affordance:
        return cls(
            action=data["action"],
            label=data.get("label"),
            description=data.get("description"),
            params=data.get("params"),
            dangerous=data.get("dangerous", False),
            idempotent=data.get("idempotent", False),
            estimate=data.get("estimate"),
        )


@dataclass
class ContentRef:
    """Reference to content that can be fetched on demand."""

    type: Literal["text", "binary", "stream"]
    mime: str
    summary: str
    size: int | None = None
    uri: str | None = None
    preview: str | None = None
    encoding: str | None = None
    hash: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type, "mime": self.mime, "summary": self.summary}
        for name in ("size", "uri", "preview", "encoding", "hash"):
            v = getattr(self, name)
            if v is not None:
                d[name] = v
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ContentRef:
        return cls(
            type=data["type"],
            mime=data["mime"],
            summary=data["summary"],
            size=data.get("size"),
            uri=data.get("uri"),
            preview=data.get("preview"),
            encoding=data.get("encoding"),
            hash=data.get("hash"),
        )


@dataclass
class SlopNode:
    """A single node in the SLOP state tree (wire format)."""

    id: str
    type: str
    properties: dict[str, Any] | None = None
    children: list[SlopNode] | None = None
    affordances: list[Affordance] | None = None
    meta: NodeMeta | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "type": self.type}
        if self.properties is not None:
            d["properties"] = self.properties
        if self.children is not None:
            d["children"] = [c.to_dict() for c in self.children]
        if self.affordances is not None:
            d["affordances"] = [a.to_dict() for a in self.affordances]
        if self.meta is not None:
            d["meta"] = self.meta.to_dict()
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SlopNode:
        children = None
        if "children" in data and data["children"] is not None:
            children = [SlopNode.from_dict(c) for c in data["children"]]
        affordances = None
        if "affordances" in data and data["affordances"] is not None:
            affordances = [Affordance.from_dict(a) for a in data["affordances"]]
        meta = None
        if "meta" in data and data["meta"] is not None:
            meta = NodeMeta.from_dict(data["meta"])
        return cls(
            id=data["id"],
            type=data["type"],
            properties=data.get("properties"),
            children=children,
            affordances=affordances,
            meta=meta,
        )

    def to_json(self, **kwargs: Any) -> str:
        return json.dumps(self.to_dict(), **kwargs)


@dataclass
class PatchOp:
    """A single JSON Patch (RFC 6902) operation."""

    op: Literal["add", "remove", "replace"]
    path: str
    value: Any = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"op": self.op, "path": self.path}
        if self.op != "remove":
            d["value"] = self.value
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PatchOp:
        return cls(op=data["op"], path=data["path"], value=data.get("value"))
