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

# Scaling
from .scaling import (
    OutputTreeOptions,
    auto_compact,
    count_nodes,
    filter_tree,
    get_subtree,
    prepare_tree,
    truncate_tree,
)

# Helpers
from .helpers import pick, omit

# Server
from .server import SlopServer, Connection

# Consumer
from .state_mirror import StateMirror
from .consumer import SlopConsumer
from .tools import (
    LlmTool,
    affordances_to_tools,
    encode_tool,
    decode_tool,
    format_tree,
)

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
    # Scaling
    "OutputTreeOptions",
    "prepare_tree",
    "truncate_tree",
    "filter_tree",
    "auto_compact",
    "get_subtree",
    "count_nodes",
    # Helpers
    "pick",
    "omit",
    # Server
    "SlopServer",
    "Connection",
    # Consumer
    "StateMirror",
    "SlopConsumer",
    "LlmTool",
    "affordances_to_tools",
    "encode_tool",
    "decode_tool",
    "format_tree",
]
