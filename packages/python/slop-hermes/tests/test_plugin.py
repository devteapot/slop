from __future__ import annotations

from slop_hermes.plugin import register


def test_register_adds_tools_and_hooks() -> None:
    ctx = _FakeContext()

    register(ctx)

    assert sorted(ctx.tools) == [
        "app_action",
        "app_action_batch",
        "connect_app",
        "disconnect_app",
        "list_apps",
    ]
    assert sorted(ctx.hooks) == ["on_session_start", "pre_llm_call"]
    assert all(toolset == "slop" for toolset in ctx.tools.values())


class _FakeContext:
    def __init__(self) -> None:
        self.tools: dict[str, str] = {}
        self.hooks: dict[str, object] = {}

    def register_tool(self, *, name, toolset, schema, handler, **_kwargs) -> None:
        assert schema["name"] == name
        self.tools[name] = toolset

    def register_hook(self, name, callback) -> None:
        self.hooks[name] = callback
