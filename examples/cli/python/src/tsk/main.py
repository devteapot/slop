"""Entry point — parse args and dispatch to CLI or SLOP mode."""

from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="tsk",
        description="A task manager CLI and SLOP provider",
    )
    parser.add_argument("--slop", action="store_true", help="Enter SLOP provider mode")
    parser.add_argument("--file", "-f", default=None, help="Path to tasks JSON file")

    subparsers = parser.add_subparsers(dest="command")

    # list
    p_list = subparsers.add_parser("list", help="List tasks")
    p_list.add_argument("--all", "-a", action="store_true", dest="show_all", help="Include completed tasks")
    p_list.add_argument("--tag", "-t", default=None, help="Filter by tag")

    # add
    p_add = subparsers.add_parser("add", help="Add a new task")
    p_add.add_argument("title", help="Task title")
    p_add.add_argument("--due", "-d", default=None, help="Due date")
    p_add.add_argument("--tag", "-t", default=None, help="Tag (comma-separated)")

    # done
    p_done = subparsers.add_parser("done", help="Mark task complete")
    p_done.add_argument("id", help="Task ID or number")

    # undo
    p_undo = subparsers.add_parser("undo", help="Mark task incomplete")
    p_undo.add_argument("id", help="Task ID or number")

    # edit
    p_edit = subparsers.add_parser("edit", help="Edit a task")
    p_edit.add_argument("id", help="Task ID or number")
    p_edit.add_argument("--title", default=None, help="New title")
    p_edit.add_argument("--due", default=None, help="New due date")
    p_edit.add_argument("--tag", default=None, help="New tags (comma-separated)")

    # delete
    p_del = subparsers.add_parser("delete", help="Delete a task")
    p_del.add_argument("id", help="Task ID or number")

    # notes
    p_notes = subparsers.add_parser("notes", help="Show or set task notes")
    p_notes.add_argument("id", help="Task ID or number")
    p_notes.add_argument("--set", "-s", default=None, dest="set_text", help="Set notes text")

    # search
    p_search = subparsers.add_parser("search", help="Search tasks")
    p_search.add_argument("query", help="Search term")

    # export
    p_export = subparsers.add_parser("export", help="Export tasks")
    p_export.add_argument("format", choices=["json", "csv", "markdown"], help="Export format")

    args = parser.parse_args()

    # SLOP mode
    if args.slop:
        from tsk.slop_provider import run_slop
        run_slop(args.file)
        return

    # CLI mode
    from tsk.cli import (
        cmd_list, cmd_add, cmd_done, cmd_undo, cmd_edit,
        cmd_delete, cmd_notes, cmd_search, cmd_export,
    )

    cmd = args.command

    if cmd is None or cmd == "list":
        show_all = getattr(args, "show_all", False)
        tag = getattr(args, "tag", None)
        cmd_list(args.file, tag=tag, show_all=show_all)
    elif cmd == "add":
        cmd_add(args.file, args.title, due=args.due, tag=args.tag)
    elif cmd == "done":
        cmd_done(args.file, args.id)
    elif cmd == "undo":
        cmd_undo(args.file, args.id)
    elif cmd == "edit":
        cmd_edit(args.file, args.id, title=args.title, due=args.due, tag=args.tag)
    elif cmd == "delete":
        cmd_delete(args.file, args.id)
    elif cmd == "notes":
        cmd_notes(args.file, args.id, set_text=args.set_text)
    elif cmd == "search":
        cmd_search(args.file, args.query)
    elif cmd == "export":
        cmd_export(args.file, args.format)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
