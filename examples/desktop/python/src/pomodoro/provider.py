"""SLOP provider — expose Pomodoro timer as an observable state tree."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from slop import SlopServer
from slop.transports.unix import listen as listen_unix

from pomodoro.pomodoro import PomodoroTimer, Phase

DEFAULT_SOCK = "/tmp/slop/pomodoro.sock"


def setup_provider(timer: PomodoroTimer) -> SlopServer:
    """Create and configure the SLOP server with the Pomodoro tree."""
    slop = SlopServer("pomodoro", "Pomodoro Timer")

    @slop.node("timer")
    def timer_node() -> dict[str, Any]:
        actions: dict[str, Any] = {}

        if timer.phase == Phase.IDLE:
            actions["start"] = {
                "handler": lambda params: timer.start(params.get("tag")),
                "label": "Start pomodoro",
                "description": "Start a 25-minute work session",
                "params": {
                    "tag": {"type": "string", "description": "What you're working on"},
                },
                "estimate": "instant",
            }
        elif not timer.paused:
            # Running (working or break)
            actions["pause"] = {
                "handler": lambda params: timer.pause(),
                "label": "Pause timer",
                "estimate": "instant",
            }
            actions["skip"] = {
                "handler": lambda params: timer.skip(),
                "label": "Skip to next phase",
                "description": "Skip the current timer and advance to the next phase (work -> break, break -> idle)",
                "estimate": "instant",
            }
            actions["stop"] = {
                "handler": lambda params: timer.stop(),
                "label": "Stop timer",
                "description": "Abandon the current session and return to idle",
                "dangerous": True,
                "estimate": "instant",
            }
            if timer.phase == Phase.WORKING:
                actions["tag"] = {
                    "handler": lambda params: timer.set_tag(params["label"]),
                    "label": "Tag session",
                    "description": "Set or change the tag on the current session",
                    "params": {
                        "label": {"type": "string", "description": "Session label"},
                    },
                    "estimate": "instant",
                }
        else:
            # Paused
            actions["resume"] = {
                "handler": lambda params: timer.resume(),
                "label": "Resume timer",
                "estimate": "instant",
            }
            actions["stop"] = {
                "handler": lambda params: timer.stop(),
                "label": "Stop timer",
                "description": "Abandon the current session and return to idle",
                "dangerous": True,
                "estimate": "instant",
            }
            if timer.phase == Phase.WORKING:
                actions["tag"] = {
                    "handler": lambda params: timer.set_tag(params["label"]),
                    "label": "Tag session",
                    "description": "Set or change the tag on the current session",
                    "params": {
                        "label": {"type": "string", "description": "Session label"},
                    },
                    "estimate": "instant",
                }

        # Build meta based on phase
        meta: dict[str, Any] = {}
        time_str = timer.format_time(timer.time_remaining_sec)

        if timer.phase == Phase.IDLE:
            meta = {"salience": 0.3, "reason": "Timer is idle"}
        elif timer.phase == Phase.WORKING and not timer.paused:
            meta = {
                "salience": 1.0,
                "urgency": "low",
                "focus": True,
                "reason": f"Working: {time_str} remaining",
            }
        elif timer.phase == Phase.WORKING and timer.paused:
            meta = {
                "salience": 0.8,
                "urgency": "low",
                "reason": f"Paused at {time_str}",
            }
        elif timer.phase == Phase.SHORT_BREAK:
            meta = {
                "salience": 0.9,
                "urgency": "medium",
                "reason": f"Short break: {time_str} remaining — take a break!",
            }
        elif timer.phase == Phase.LONG_BREAK:
            meta = {
                "salience": 0.9,
                "urgency": "medium",
                "reason": f"Long break: {time_str} remaining — stretch and rest!",
            }

        return {
            "type": "context",
            "props": {
                "phase": timer.phase.value,
                "paused": timer.paused,
                "time_remaining_sec": timer.time_remaining_sec,
                "time_elapsed_sec": timer.time_elapsed_sec,
                "current_tag": timer.current_tag,
                "pomodoros_until_long_break": timer.settings["long_break_interval"]
                - (timer.cycle_count % timer.settings["long_break_interval"]),
            },
            "meta": meta,
            "actions": actions,
        }

    @slop.node("sessions")
    def sessions_node() -> dict[str, Any]:
        all_sessions = list(reversed(timer.sessions))  # most recent first
        today = timer.today_sessions()
        today_count = len(today)

        items: list[dict[str, Any]] = []
        for s in all_sessions:
            sal, reason = timer.session_salience(s)
            item: dict[str, Any] = {
                "id": s["id"],
                "props": {
                    "tag": s.get("tag", "Untitled"),
                    "category": s.get("category", "work"),
                    "started_at": s.get("started_at", ""),
                    "ended_at": s.get("ended_at", ""),
                    "duration_sec": s.get("duration_sec", 0),
                    "completed": s.get("completed", False),
                },
                "meta": {"salience": sal, "reason": reason},
                "actions": {
                    "tag": {
                        "handler": lambda params, sid=s["id"]: timer.tag_session(sid, params["label"]),
                        "label": "Re-tag session",
                        "params": {
                            "label": "string",
                        },
                        "estimate": "instant",
                    },
                    "delete": {
                        "handler": lambda params, sid=s["id"]: timer.delete_session(sid),
                        "label": "Delete session",
                        "dangerous": True,
                        "estimate": "instant",
                    },
                },
            }
            items.append(item)

        count = len(timer.sessions)
        summary = f"{today_count} pomodoro{'s' if today_count != 1 else ''} completed today"

        return {
            "type": "collection",
            "props": {"count": count, "today_count": today_count},
            "meta": {
                "summary": summary,
                "total_children": count,
            },
            "window": {
                "items": items,
                "total": count,
                "offset": 0,
            },
        }

    @slop.node("stats")
    def stats_node() -> dict[str, Any]:
        stats = timer.today_stats()
        summary = (
            f"{stats['today_completed']} pomodoros today "
            f"({stats['today_total_focus_min']} min focus), "
            f"{stats['streak_days']}-day streak"
        )
        return {
            "type": "context",
            "props": stats,
            "meta": {"summary": summary},
        }

    return slop


# --- Discovery ---


def write_discovery(timer: PomodoroTimer, socket_path: str) -> None:
    """Write the discovery file for this provider."""
    providers_dir = Path.home() / ".slop" / "providers"
    providers_dir.mkdir(parents=True, exist_ok=True)
    desc = {
        "id": "pomodoro",
        "name": "Pomodoro Timer",
        "version": "0.1.0",
        "slop_version": "0.1",
        "transport": {"type": "unix", "path": socket_path},
        "pid": os.getpid(),
        "capabilities": ["state", "patches", "affordances", "attention"],
        "description": timer.description(),
    }
    (providers_dir / "pomodoro.json").write_text(json.dumps(desc, indent=2) + "\n")


def update_discovery(timer: PomodoroTimer, socket_path: str) -> None:
    """Update the discovery file description."""
    write_discovery(timer, socket_path)


def cleanup_discovery() -> None:
    """Remove the discovery file."""
    path = Path.home() / ".slop" / "providers" / "pomodoro.json"
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass
