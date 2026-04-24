"""Minimal JSON Schema validator for affordance invoke params.

Mirrors the TypeScript `validateParams` so the `invalid_params` error code is
reliable across SDKs. Covers the subset the SLOP affordance schema uses:

* ``type``: object | string | number | integer | boolean | array | null
* ``required``: list[str]                  (for objects)
* ``properties``: dict[str, schema]         (for objects)
* ``items``: schema                         (for arrays)
* ``enum``: list[Any]
"""

from __future__ import annotations

import json
from typing import Any


def validate_params(schema: dict[str, Any] | None, params: Any) -> str | None:
    """Return ``None`` on success, or a human-readable error message."""
    if not schema:
        return None
    return _validate(schema, params, "params")


def _validate(schema: dict[str, Any], value: Any, path: str) -> str | None:
    if "enum" in schema and not any(_deep_equal(option, value) for option in schema["enum"]):
        return f"{path} must be one of {json.dumps(schema['enum'])}"

    t = schema.get("type")
    if t == "object":
        if not isinstance(value, dict):
            return f"{path} must be an object"
        for key in schema.get("required", []) or []:
            if key not in value:
                return f"{path}.{key} is required"
        for key, prop_schema in (schema.get("properties") or {}).items():
            if key in value:
                err = _validate(prop_schema, value[key], f"{path}.{key}")
                if err:
                    return err
        return None
    if t == "array":
        if not isinstance(value, list):
            return f"{path} must be an array"
        items = schema.get("items")
        if items:
            for i, item in enumerate(value):
                err = _validate(items, item, f"{path}[{i}]")
                if err:
                    return err
        return None
    if t == "string":
        return None if isinstance(value, str) else f"{path} must be a string"
    if t == "number":
        return None if isinstance(value, (int, float)) and not isinstance(value, bool) else f"{path} must be a number"
    if t == "integer":
        return None if isinstance(value, int) and not isinstance(value, bool) else f"{path} must be an integer"
    if t == "boolean":
        return None if isinstance(value, bool) else f"{path} must be a boolean"
    if t == "null":
        return None if value is None else f"{path} must be null"
    # Unknown type — be permissive rather than reject.
    return None


def _deep_equal(a: Any, b: Any) -> bool:
    if a is b:
        return True
    if type(a) is not type(b):
        # Allow int/float equivalence.
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return a == b
        return False
    try:
        return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    except TypeError:
        return a == b
