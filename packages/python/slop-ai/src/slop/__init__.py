"""slop-ai — Python SDK for the SLOP protocol.

Usage::

    from slop import SlopServer

    slop = SlopServer("my-app", "My App")

    @slop.node("todos")
    def todos_node():
        return {"type": "collection", "items": [...]}
"""

# Wire types
from .types import (
    Affordance,
    ContentRef,
    NodeMeta,
    PatchOp,
    SlopNode,
)

# Engine
from .descriptor import normalize_descriptor
from .tree import assemble_tree
from .diff import diff_nodes

# Helpers
from .helpers import pick, omit

# Server
from .server import SlopServer, Connection

__all__ = [
    # Wire types
    "SlopNode",
    "Affordance",
    "NodeMeta",
    "PatchOp",
    "ContentRef",
    # Engine
    "normalize_descriptor",
    "assemble_tree",
    "diff_nodes",
    # Helpers
    "pick",
    "omit",
    # Server
    "SlopServer",
    "Connection",
]
