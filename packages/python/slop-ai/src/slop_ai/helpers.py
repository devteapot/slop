"""Utility helpers for working with SLOP descriptors."""

from __future__ import annotations

from typing import Any, Iterable


def pick(d: dict[str, Any], keys: Iterable[str]) -> dict[str, Any]:
    """Return a new dict with only the specified keys."""
    key_set = set(keys)
    return {k: v for k, v in d.items() if k in key_set}


def omit(d: dict[str, Any], keys: Iterable[str]) -> dict[str, Any]:
    """Return a new dict without the specified keys."""
    key_set = set(keys)
    return {k: v for k, v in d.items() if k not in key_set}
