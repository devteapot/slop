"""Task storage — load/save tasks.json."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

_DEFAULT_DIR = Path.home() / ".tsk"
_DEFAULT_FILE = _DEFAULT_DIR / "tasks.json"
_SEED_FILE = Path(__file__).resolve().parent.parent.parent / "seed.json"


def _resolve_path(file_override: str | None = None) -> Path:
    if file_override:
        return Path(file_override).expanduser().resolve()
    env = os.environ.get("TSK_FILE")
    if env:
        return Path(env).expanduser().resolve()
    return _DEFAULT_FILE


def load_tasks(file_override: str | None = None) -> list[dict[str, Any]]:
    """Load tasks from disk. Seeds from seed.json on first run."""
    path = _resolve_path(file_override)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        if _SEED_FILE.exists():
            shutil.copy2(_SEED_FILE, path)
        else:
            path.write_text('{"tasks": []}')
    data = json.loads(path.read_text())
    return data.get("tasks", [])


def save_tasks(tasks: list[dict[str, Any]], file_override: str | None = None) -> None:
    """Write tasks back to disk."""
    path = _resolve_path(file_override)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"tasks": tasks}, indent=2) + "\n")


def get_file_path(file_override: str | None = None) -> str:
    """Return the resolved file path as a string."""
    return str(_resolve_path(file_override))


def next_id(tasks: list[dict[str, Any]]) -> str:
    """Generate the next task ID."""
    max_num = 0
    for t in tasks:
        tid = t.get("id", "")
        if tid.startswith("t-"):
            try:
                max_num = max(max_num, int(tid[2:]))
            except ValueError:
                pass
    return f"t-{max_num + 1}"
