"""Affordance param validation — mirror of TS validate-params.test.ts."""

from __future__ import annotations

from slop_ai.validate_params import validate_params


def test_empty_params_ok_when_no_required() -> None:
    assert validate_params({"type": "object"}, {}) is None
    assert validate_params(None, {"anything": 1}) is None


def test_missing_required_key_rejected() -> None:
    err = validate_params({"type": "object", "required": ["body"]}, {})
    assert err is not None
    assert "body" in err
    assert "required" in err


def test_wrong_type_rejected() -> None:
    err = validate_params(
        {"type": "object", "properties": {"count": {"type": "integer"}}},
        {"count": "not-an-int"},
    )
    assert err is not None
    assert "count" in err


def test_enum_mismatch() -> None:
    err = validate_params(
        {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": ["open", "closed"]}},
        },
        {"status": "other"},
    )
    assert err is not None


def test_array_items_validated() -> None:
    schema = {
        "type": "object",
        "properties": {"tags": {"type": "array", "items": {"type": "string"}}},
    }
    assert validate_params(schema, {"tags": ["a", "b"]}) is None
    err = validate_params(schema, {"tags": ["a", 2]})
    assert err is not None
    assert "tags[1]" in err
