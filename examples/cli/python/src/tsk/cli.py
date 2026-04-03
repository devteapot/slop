"""Human-readable CLI commands with ANSI color output."""

from __future__ import annotations

import csv
import io
import json
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

from tsk.store import load_tasks, save_tasks, next_id, get_file_path

# ANSI escape codes
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
RESET = "\033[0m"
STRIKE = "\033[9m"


def _today() -> date:
    return date.today()


def _parse_due(s: str) -> str:
    """Parse a human-friendly due date into ISO format."""
    low = s.lower().strip()
    today = _today()
    if low == "today":
        return today.isoformat()
    if low == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if low.startswith("next "):
        # next monday, next tuesday, etc.
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        target = low[5:].strip()
        if target in day_names:
            target_dow = day_names.index(target)
            current_dow = today.weekday()
            days_ahead = (target_dow - current_dow) % 7
            if days_ahead == 0:
                days_ahead = 7
            return (today + timedelta(days=days_ahead)).isoformat()
    # Try ISO parse
    return s


def _due_label(task: dict[str, Any]) -> str:
    """Format due date for display."""
    due_str = task.get("due")
    if not due_str:
        return ""
    try:
        due = date.fromisoformat(due_str)
    except ValueError:
        return f"due: {due_str}"
    today = _today()
    diff = (due - today).days
    if diff < 0:
        return f"{RED}due: overdue!{RESET}"
    if diff == 0:
        return f"{YELLOW}due: today{RESET}"
    if diff == 1:
        return f"due: tomorrow"
    return f"due: {due_str}"


def _completed_label(task: dict[str, Any]) -> str:
    cat = task.get("completed_at")
    if not cat:
        return "done"
    try:
        completed = datetime.fromisoformat(cat.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = now - completed
        hours = int(diff.total_seconds() / 3600)
        if hours < 1:
            return "done: just now"
        if hours < 24:
            return f"done: {hours}h ago"
        days = hours // 24
        return f"done: {days}d ago"
    except ValueError:
        return "done"


def _format_tags(tags: list[str]) -> str:
    if not tags:
        return ""
    return " ".join(f"{CYAN}#{t}{RESET}" for t in tags)


def _print_task(task: dict[str, Any], num: int | None = None) -> None:
    tid = task["id"]
    idx = tid.replace("t-", "") if num is None else str(num)
    done = task.get("done", False)
    title = task["title"]
    tags = task.get("tags", [])

    check = f"{GREEN}[x]{RESET}" if done else "[ ]"
    title_fmt = f"{DIM}{STRIKE}{title}{RESET}" if done else title

    if done:
        time_str = _completed_label(task)
    else:
        time_str = _due_label(task)

    tag_str = _format_tags(tags)
    parts = [f"  {idx:>3}. {check} {title_fmt:<30s}"]
    if time_str:
        parts.append(time_str)
    if tag_str:
        parts.append(tag_str)
    print("  ".join(parts))


def _find_task(tasks: list[dict[str, Any]], ref: str) -> dict[str, Any] | None:
    """Find task by id or number."""
    # Try direct id match
    for t in tasks:
        if t["id"] == ref:
            return t
    # Try numeric match (t-N)
    tid = f"t-{ref}" if not ref.startswith("t-") else ref
    for t in tasks:
        if t["id"] == tid:
            return t
    return None


def cmd_list(file: str | None, tag: str | None = None, show_all: bool = False) -> None:
    tasks = load_tasks(file)
    if tag:
        tasks = [t for t in tasks if tag in t.get("tags", [])]
    if not show_all:
        tasks = [t for t in tasks if not t.get("done", False)]

    if not tasks:
        print("No tasks found.")
        return

    # Sort: pending first (overdue, today, later), then done
    def sort_key(t: dict[str, Any]) -> tuple:
        if t.get("done"):
            return (1, "")
        due = t.get("due", "9999-99-99")
        return (0, due)

    tasks.sort(key=sort_key)
    for i, t in enumerate(tasks, 1):
        _print_task(t, i)


def cmd_add(file: str | None, title: str, due: str | None = None, tag: str | None = None) -> None:
    tasks = load_tasks(file)
    tid = next_id(tasks)
    task: dict[str, Any] = {
        "id": tid,
        "title": title,
        "done": False,
        "tags": [t.strip() for t in tag.split(",")] if tag else [],
        "notes": "",
        "created": datetime.now(timezone.utc).isoformat(),
    }
    if due:
        task["due"] = _parse_due(due)
    tasks.append(task)
    save_tasks(tasks, file)
    num = tid.replace("t-", "")
    print(f"Created task #{num}")


def cmd_done(file: str | None, ref: str) -> None:
    tasks = load_tasks(file)
    task = _find_task(tasks, ref)
    if not task:
        print(f"Task not found: {ref}", file=sys.stderr)
        sys.exit(1)
    task["done"] = True
    task["completed_at"] = datetime.now(timezone.utc).isoformat()
    save_tasks(tasks, file)
    print(f"Completed: {task['title']}")


def cmd_undo(file: str | None, ref: str) -> None:
    tasks = load_tasks(file)
    task = _find_task(tasks, ref)
    if not task:
        print(f"Task not found: {ref}", file=sys.stderr)
        sys.exit(1)
    task["done"] = False
    task.pop("completed_at", None)
    save_tasks(tasks, file)
    print(f"Reopened: {task['title']}")


def cmd_edit(
    file: str | None, ref: str,
    title: str | None = None, due: str | None = None, tag: str | None = None,
) -> None:
    tasks = load_tasks(file)
    task = _find_task(tasks, ref)
    if not task:
        print(f"Task not found: {ref}", file=sys.stderr)
        sys.exit(1)
    if title:
        task["title"] = title
    if due:
        task["due"] = _parse_due(due)
    if tag:
        task["tags"] = [t.strip() for t in tag.split(",")]
    save_tasks(tasks, file)
    print(f"Updated: {task['title']}")


def cmd_delete(file: str | None, ref: str) -> None:
    tasks = load_tasks(file)
    task = _find_task(tasks, ref)
    if not task:
        print(f"Task not found: {ref}", file=sys.stderr)
        sys.exit(1)
    tasks.remove(task)
    save_tasks(tasks, file)
    print(f"Deleted: {task['title']}")


def cmd_notes(file: str | None, ref: str, set_text: str | None = None) -> None:
    tasks = load_tasks(file)
    task = _find_task(tasks, ref)
    if not task:
        print(f"Task not found: {ref}", file=sys.stderr)
        sys.exit(1)
    if set_text is not None:
        task["notes"] = set_text
        save_tasks(tasks, file)
        print(f"Notes updated for: {task['title']}")
    else:
        notes = task.get("notes", "")
        if notes:
            print(notes)
        else:
            print("(no notes)")


def cmd_search(file: str | None, query: str) -> None:
    tasks = load_tasks(file)
    q = query.lower()
    matches = [
        t for t in tasks
        if q in t["title"].lower() or any(q in tag.lower() for tag in t.get("tags", []))
    ]
    if not matches:
        print("No matching tasks.")
        return
    for i, t in enumerate(matches, 1):
        _print_task(t, i)


def cmd_export(file: str | None, fmt: str) -> None:
    tasks = load_tasks(file)
    if fmt == "json":
        print(json.dumps({"tasks": tasks}, indent=2))
    elif fmt == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["id", "title", "done", "due", "tags", "notes"])
        for t in tasks:
            writer.writerow([
                t["id"], t["title"], t.get("done", False),
                t.get("due", ""), ",".join(t.get("tags", [])),
                t.get("notes", ""),
            ])
        print(out.getvalue(), end="")
    elif fmt == "markdown":
        pending = [t for t in tasks if not t.get("done")]
        done = [t for t in tasks if t.get("done")]
        print("# Tasks\n")
        if pending:
            print("## Pending\n")
            for t in pending:
                due = f" (due: {t['due']})" if t.get("due") else ""
                tags = " " + " ".join(f"`{tg}`" for tg in t.get("tags", [])) if t.get("tags") else ""
                print(f"- [ ] {t['title']}{due}{tags}")
        if done:
            print("\n## Done\n")
            for t in done:
                tags = " " + " ".join(f"`{tg}`" for tg in t.get("tags", [])) if t.get("tags") else ""
                print(f"- [x] {t['title']}{tags}")
    else:
        print(f"Unknown format: {fmt}. Use json, csv, or markdown.", file=sys.stderr)
        sys.exit(1)
