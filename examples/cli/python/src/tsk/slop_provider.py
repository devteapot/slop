"""SLOP provider mode — expose tasks as an observable state tree."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from slop import SlopServer
from slop.transports.stdio import listen

from tsk.store import load_tasks, save_tasks, next_id, get_file_path


# Module-level state shared between node functions and action handlers
_tasks: list[dict[str, Any]] = []
_file: str | None = None
_slop: SlopServer | None = None

WINDOW_SIZE = 25


def _today() -> date:
    return date.today()


def _parse_due(s: str) -> str:
    """Parse relative dates into ISO format."""
    from datetime import timedelta
    low = s.lower().strip()
    today = _today()
    if low == "today":
        return today.isoformat()
    if low == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if low.startswith("next "):
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        target = low[5:].strip()
        if target in day_names:
            target_dow = day_names.index(target)
            current_dow = today.weekday()
            days_ahead = (target_dow - current_dow) % 7
            if days_ahead == 0:
                days_ahead = 7
            return (today + timedelta(days=days_ahead)).isoformat()
    return s


def _compute_salience(task: dict[str, Any]) -> tuple[float, str | None, str | None]:
    """Return (salience, urgency, reason) for a task."""
    if task.get("done"):
        return (0.2, None, None)

    due_str = task.get("due")
    if not due_str:
        return (0.4, None, None)

    try:
        due = date.fromisoformat(due_str)
    except ValueError:
        return (0.4, None, None)

    today = _today()
    diff = (due - today).days

    if diff < 0:
        return (1.0, "high", f"{-diff} day{'s' if -diff != 1 else ''} overdue")
    if diff == 0:
        return (0.9, "medium", "due today")
    if diff <= 7:
        return (0.7, "low", None)
    return (0.5, None, None)


def _sorted_tasks() -> list[dict[str, Any]]:
    """Return tasks sorted by salience descending."""
    def key(t: dict[str, Any]) -> float:
        sal, _, _ = _compute_salience(t)
        return -sal
    return sorted(_tasks, key=key)


def _content_ref(task: dict[str, Any]) -> dict[str, Any]:
    """Build a content_ref dict for a task's notes."""
    notes = task.get("notes", "")
    if not notes:
        return {
            "type": "text",
            "mime": "text/plain",
            "summary": "No notes",
        }
    lines = notes.strip().split("\n")
    line_count = len(lines)
    preview = notes[:100]
    if len(notes) > 100:
        preview += "..."
    return {
        "type": "text",
        "mime": "text/plain",
        "size": len(notes),
        "summary": f"{line_count} line{'s' if line_count != 1 else ''} of notes",
        "preview": preview,
    }


def _build_item(task: dict[str, Any]) -> dict[str, Any]:
    """Build an item descriptor dict for one task."""
    tid = task["id"]
    salience, urgency, reason = _compute_salience(task)

    props: dict[str, Any] = {
        "title": task["title"],
        "done": task.get("done", False),
    }
    if task.get("due"):
        props["due"] = task["due"]
    if task.get("tags"):
        props["tags"] = task["tags"]
    if task.get("completed_at"):
        props["completed_at"] = task["completed_at"]

    # Content ref goes into props as per descriptor.py normalization
    props["content_ref"] = _content_ref(task)

    meta: dict[str, Any] = {"salience": salience}
    if urgency:
        meta["urgency"] = urgency
    if reason:
        meta["reason"] = reason

    # Actions differ for pending vs completed tasks
    actions: dict[str, Any] = {}
    if task.get("done"):
        actions["undo"] = {
            "handler": lambda params, _tid=tid: _action_undo(_tid),
            "label": "Mark incomplete",
            "estimate": "instant",
        }
    else:
        actions["done"] = {
            "handler": lambda params, _tid=tid: _action_done(_tid),
            "label": "Complete task",
            "estimate": "instant",
        }
        actions["edit"] = {
            "handler": lambda params, _tid=tid: _action_edit(_tid, params),
            "label": "Edit task",
            "params": {
                "title": {"type": "string"},
                "due": {"type": "string"},
                "tags": {"type": "string"},
            },
            "estimate": "instant",
        }
    actions["delete"] = {
        "handler": lambda params, _tid=tid: _action_delete(_tid),
        "label": "Delete task",
        "dangerous": True,
        "estimate": "instant",
    }
    actions["read_notes"] = {
        "handler": lambda params, _tid=tid: _action_read_notes(_tid),
        "label": "Read full notes",
        "description": "Fetch the complete notes for this task",
        "idempotent": True,
        "estimate": "instant",
    }
    actions["write_notes"] = {
        "handler": lambda params, _tid=tid: _action_write_notes(_tid, params),
        "label": "Write notes",
        "params": {"content": "string"},
        "estimate": "instant",
    }

    return {
        "id": tid,
        "props": props,
        "meta": meta,
        "actions": actions,
    }


# --- Action handlers ---

def _reload() -> None:
    global _tasks
    _tasks = load_tasks(_file)


def _save_and_refresh() -> None:
    save_tasks(_tasks, _file)
    if _slop:
        _slop.refresh()


def _action_add(title: str, due: str | None = None, tags: str | None = None) -> dict[str, Any]:
    tid = next_id(_tasks)
    task: dict[str, Any] = {
        "id": tid,
        "title": title,
        "done": False,
        "tags": [t.strip() for t in tags.split(",")] if tags else [],
        "notes": "",
        "created": datetime.now(timezone.utc).isoformat(),
    }
    if due:
        task["due"] = _parse_due(due)
    _tasks.append(task)
    _save_and_refresh()
    return {"id": tid, "title": title}


def _action_clear_done() -> dict[str, Any]:
    global _tasks
    count = len([t for t in _tasks if t.get("done")])
    _tasks = [t for t in _tasks if not t.get("done")]
    _save_and_refresh()
    return {"cleared": count}


def _action_export(fmt: str = "json") -> dict[str, Any]:
    """Export tasks. Returns async marker so consumer sees accepted status."""
    import csv as csv_mod
    import io

    if fmt == "json":
        content = json.dumps({"tasks": _tasks}, indent=2)
    elif fmt == "csv":
        out = io.StringIO()
        writer = csv_mod.writer(out)
        writer.writerow(["id", "title", "done", "due", "tags", "notes"])
        for t in _tasks:
            writer.writerow([
                t["id"], t["title"], t.get("done", False),
                t.get("due", ""), ",".join(t.get("tags", [])),
                t.get("notes", ""),
            ])
        content = out.getvalue()
    elif fmt == "markdown":
        lines = ["# Tasks\n"]
        pending = [t for t in _tasks if not t.get("done")]
        done = [t for t in _tasks if t.get("done")]
        if pending:
            lines.append("## Pending\n")
            for t in pending:
                due_s = f" (due: {t['due']})" if t.get("due") else ""
                tag_s = " " + " ".join(f"`{tg}`" for tg in t.get("tags", [])) if t.get("tags") else ""
                lines.append(f"- [ ] {t['title']}{due_s}{tag_s}")
        if done:
            lines.append("\n## Done\n")
            for t in done:
                tag_s = " " + " ".join(f"`{tg}`" for tg in t.get("tags", [])) if t.get("tags") else ""
                lines.append(f"- [x] {t['title']}{tag_s}")
        content = "\n".join(lines)
    else:
        return {"error": f"Unknown format: {fmt}"}

    return {"format": fmt, "content": content, "size": len(content)}


def _action_search(query: str) -> dict[str, Any]:
    q = query.lower()
    matches = [
        t for t in _tasks
        if q in t["title"].lower() or any(q in tag.lower() for tag in t.get("tags", []))
    ]
    return {
        "count": len(matches),
        "tasks": [{"id": t["id"], "title": t["title"], "done": t.get("done", False)} for t in matches],
    }


def _action_done(tid: str) -> dict[str, Any]:
    for t in _tasks:
        if t["id"] == tid:
            t["done"] = True
            t["completed_at"] = datetime.now(timezone.utc).isoformat()
            _save_and_refresh()
            return {"id": tid, "title": t["title"]}
    return {"error": "not found"}


def _action_undo(tid: str) -> dict[str, Any]:
    for t in _tasks:
        if t["id"] == tid:
            t["done"] = False
            t.pop("completed_at", None)
            _save_and_refresh()
            return {"id": tid, "title": t["title"]}
    return {"error": "not found"}


def _action_edit(tid: str, params: dict[str, Any]) -> dict[str, Any]:
    for t in _tasks:
        if t["id"] == tid:
            if "title" in params:
                t["title"] = params["title"]
            if "due" in params:
                t["due"] = _parse_due(params["due"])
            if "tags" in params:
                t["tags"] = [tg.strip() for tg in params["tags"].split(",")]
            _save_and_refresh()
            return {"id": tid, "title": t["title"]}
    return {"error": "not found"}


def _action_delete(tid: str) -> dict[str, Any]:
    global _tasks
    for t in _tasks:
        if t["id"] == tid:
            _tasks.remove(t)
            _save_and_refresh()
            return {"id": tid, "title": t["title"]}
    return {"error": "not found"}


def _action_read_notes(tid: str) -> dict[str, Any]:
    for t in _tasks:
        if t["id"] == tid:
            return {"content": t.get("notes", "")}
    return {"error": "not found"}


def _action_write_notes(tid: str, params: dict[str, Any]) -> dict[str, Any]:
    for t in _tasks:
        if t["id"] == tid:
            t["notes"] = params.get("content", "")
            _save_and_refresh()
            return {"id": tid}
    return {"error": "not found"}


def _action_rename_tag(old: str, new: str) -> dict[str, Any]:
    count = 0
    for t in _tasks:
        tags = t.get("tags", [])
        if old in tags:
            tags[tags.index(old)] = new
            count += 1
    _save_and_refresh()
    return {"renamed": count, "old": old, "new": new}


# --- Discovery ---

def _write_discovery(task_summary: str) -> None:
    providers_dir = Path.home() / ".slop" / "providers"
    providers_dir.mkdir(parents=True, exist_ok=True)
    desc = {
        "id": "tsk",
        "name": "tsk",
        "version": "0.1.0",
        "slop_version": "0.1",
        "transport": {"type": "stdio", "command": ["tsk", "--slop"]},
        "pid": os.getpid(),
        "capabilities": ["state", "patches", "affordances", "attention"],
        "description": task_summary,
    }
    (providers_dir / "tsk.json").write_text(json.dumps(desc, indent=2) + "\n")


def _cleanup_discovery() -> None:
    path = Path.home() / ".slop" / "providers" / "tsk.json"
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


# --- Provider setup ---

def run_slop(file_override: str | None = None) -> None:
    """Enter SLOP provider mode."""
    global _tasks, _file, _slop

    _file = file_override
    _tasks = load_tasks(_file)

    slop = SlopServer("tsk", "tsk")
    _slop = slop

    # User context node
    @slop.node("user")
    def user_node() -> dict[str, Any]:
        total = len(_tasks)
        total_done = len([t for t in _tasks if t.get("done")])
        return {
            "type": "context",
            "props": {
                "file": get_file_path(_file),
                "total_tasks": total,
                "total_done": total_done,
            },
        }

    # Tasks collection node
    @slop.node("tasks")
    def tasks_node() -> dict[str, Any]:
        sorted_list = _sorted_tasks()
        total = len(sorted_list)
        pending = len([t for t in sorted_list if not t.get("done")])
        done = total - pending
        overdue = len([
            t for t in sorted_list
            if not t.get("done") and t.get("due") and _is_overdue(t)
        ])

        window_items = sorted_list[:WINDOW_SIZE]
        items = [_build_item(t) for t in window_items]

        summary = f"{total} tasks: {pending} pending, {done} done"
        if overdue:
            summary += f", {overdue} overdue"

        return {
            "type": "collection",
            "props": {
                "count": total,
                "pending": pending,
                "overdue": overdue,
            },
            "summary": summary,
            "window": {
                "items": items,
                "total": total,
                "offset": 0,
            },
            "actions": {
                "add": {
                    "handler": lambda params: _action_add(
                        params["title"],
                        params.get("due"),
                        params.get("tags"),
                    ),
                    "label": "Add task",
                    "params": {
                        "title": "string",
                        "due": {"type": "string", "description": "ISO date or relative: 'today', 'tomorrow', 'next monday'"},
                        "tags": {"type": "string", "description": "Comma-separated tags"},
                    },
                    "estimate": "instant",
                },
                "clear_done": {
                    "handler": lambda params: _action_clear_done(),
                    "label": "Clear completed",
                    "description": "Remove all completed tasks",
                    "dangerous": True,
                    "estimate": "instant",
                },
                "export": {
                    "handler": lambda params: _action_export(params.get("format", "json")),
                    "label": "Export tasks",
                    "description": "Export tasks to a file",
                    "params": {
                        "format": {"type": "string", "enum": ["json", "csv", "markdown"]},
                    },
                    "estimate": "slow",
                },
                "search": {
                    "handler": lambda params: _action_search(params.get("query", "")),
                    "label": "Search tasks",
                    "description": "Search tasks by title or tag",
                    "params": {
                        "query": {"type": "string", "description": "Search term (matches title and tags)"},
                    },
                    "idempotent": True,
                    "estimate": "instant",
                },
            },
        }

    # Tags collection node
    @slop.node("tags")
    def tags_node() -> dict[str, Any]:
        tag_counts: Counter[str] = Counter()
        for t in _tasks:
            for tag in t.get("tags", []):
                tag_counts[tag] += 1

        count = len(tag_counts)
        parts = [f"{tag} ({c})" for tag, c in tag_counts.most_common()]
        summary = f"{count} tags: {', '.join(parts)}" if parts else "0 tags"

        return {
            "type": "collection",
            "props": {"count": count},
            "summary": summary,
            "actions": {
                "rename": {
                    "handler": lambda params: _action_rename_tag(params["old"], params["new"]),
                    "label": "Rename tag",
                    "params": {"old": "string", "new": "string"},
                    "estimate": "instant",
                },
            },
        }

    # Write discovery and summary
    total = len(_tasks)
    pending = len([t for t in _tasks if not t.get("done")])
    overdue = len([t for t in _tasks if not t.get("done") and t.get("due") and _is_overdue(t)])
    _write_discovery(f"Task manager with {total} tasks ({pending} pending, {overdue} overdue)")

    try:
        asyncio.run(listen(slop))
    finally:
        _cleanup_discovery()
        slop.stop()


def _is_overdue(task: dict[str, Any]) -> bool:
    due_str = task.get("due")
    if not due_str:
        return False
    try:
        return date.fromisoformat(due_str) < _today()
    except ValueError:
        return False
