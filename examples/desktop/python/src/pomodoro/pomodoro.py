"""Pomodoro timer state machine and session store."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class Phase(Enum):
    IDLE = "idle"
    WORKING = "working"
    SHORT_BREAK = "short_break"
    LONG_BREAK = "long_break"


_DEFAULT_DIR = Path.home() / ".pomodoro"
_DEFAULT_FILE = _DEFAULT_DIR / "sessions.json"
_SEED_FILE = Path(__file__).resolve().parent.parent.parent / "seed.json"


class PomodoroTimer:
    """Core timer state machine with session persistence."""

    def __init__(self) -> None:
        self.phase = Phase.IDLE
        self.paused = False
        self.time_remaining_sec = 0
        self.time_elapsed_sec = 0
        self.current_tag: str | None = None
        self.cycle_count = 0  # pomodoros completed in current cycle (resets after long break)
        self.sessions: list[dict[str, Any]] = []
        self.settings: dict[str, Any] = {
            "work_duration_sec": 1500,
            "short_break_sec": 300,
            "long_break_sec": 900,
            "long_break_interval": 4,
        }
        self._current_session_start: str | None = None
        self._file_path: Path | None = None

    # --- Persistence ---

    def _resolve_path(self) -> Path:
        env = os.environ.get("POMODORO_FILE")
        if env:
            return Path(env).expanduser().resolve()
        return _DEFAULT_FILE

    def load(self) -> None:
        """Load sessions from disk, seeding from seed.json if missing."""
        path = self._resolve_path()
        self._file_path = path
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            if _SEED_FILE.exists():
                shutil.copy2(_SEED_FILE, path)
            else:
                path.write_text(json.dumps({"sessions": [], "settings": self.settings}, indent=2))
        data = json.loads(path.read_text())
        self.sessions = data.get("sessions", [])
        stored_settings = data.get("settings")
        if stored_settings:
            self.settings.update(stored_settings)

    def save(self) -> None:
        """Write sessions and settings to disk."""
        path = self._file_path or self._resolve_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"sessions": self.sessions, "settings": self.settings}
        path.write_text(json.dumps(data, indent=2) + "\n")

    # --- Timer actions ---

    def start(self, tag: str | None = None) -> dict[str, Any]:
        """Start a work session."""
        if self.phase != Phase.IDLE:
            return {"error": "Timer is not idle"}
        self.phase = Phase.WORKING
        self.paused = False
        self.time_remaining_sec = self.settings["work_duration_sec"]
        self.time_elapsed_sec = 0
        self.current_tag = tag
        self._current_session_start = datetime.now(timezone.utc).isoformat()
        return {"phase": self.phase.value, "tag": tag}

    def pause(self) -> dict[str, Any]:
        """Pause the timer."""
        if self.phase == Phase.IDLE or self.paused:
            return {"error": "Cannot pause"}
        self.paused = True
        return {"phase": self.phase.value, "paused": True}

    def resume(self) -> dict[str, Any]:
        """Resume the timer."""
        if not self.paused:
            return {"error": "Not paused"}
        self.paused = False
        return {"phase": self.phase.value, "paused": False}

    def skip(self) -> dict[str, Any]:
        """Skip to next phase."""
        if self.phase == Phase.IDLE:
            return {"error": "Nothing to skip"}
        if self.phase == Phase.WORKING:
            # Record completed session
            self._record_session(completed=True)
            self.cycle_count += 1
            # Transition to break
            if self.cycle_count % self.settings["long_break_interval"] == 0:
                self._enter_phase(Phase.LONG_BREAK)
            else:
                self._enter_phase(Phase.SHORT_BREAK)
        else:
            # On a break — go to idle
            self._enter_phase(Phase.IDLE)
        return {"phase": self.phase.value}

    def stop(self) -> dict[str, Any]:
        """Abandon current session, return to idle."""
        if self.phase == Phase.IDLE:
            return {"error": "Already idle"}
        if self.phase == Phase.WORKING:
            self._record_session(completed=False)
        self._enter_phase(Phase.IDLE)
        self.cycle_count = 0
        return {"phase": "idle"}

    def set_tag(self, label: str) -> dict[str, Any]:
        """Set or change tag on the current working session."""
        if self.phase != Phase.WORKING:
            return {"error": "Not in a working session"}
        self.current_tag = label
        return {"tag": label}

    def tag_session(self, session_id: str, label: str) -> dict[str, Any]:
        """Re-tag a completed session."""
        for s in self.sessions:
            if s["id"] == session_id:
                s["tag"] = label
                self.save()
                return {"id": session_id, "tag": label}
        return {"error": "Session not found"}

    def delete_session(self, session_id: str) -> dict[str, Any]:
        """Delete a session."""
        for s in self.sessions:
            if s["id"] == session_id:
                self.sessions.remove(s)
                self.save()
                return {"id": session_id}
        return {"error": "Session not found"}

    # --- Tick ---

    def tick(self) -> bool:
        """Called every 1 second. Returns True if a phase transition occurred."""
        if self.phase == Phase.IDLE or self.paused:
            return False

        self.time_remaining_sec -= 1
        self.time_elapsed_sec += 1

        if self.time_remaining_sec <= 0:
            self.time_remaining_sec = 0
            return self._handle_phase_end()
        return False

    # --- Helpers ---

    def next_id(self) -> str:
        """Generate next session ID (s-N)."""
        max_num = 0
        for s in self.sessions:
            sid = s.get("id", "")
            if sid.startswith("s-"):
                try:
                    max_num = max(max_num, int(sid[2:]))
                except ValueError:
                    pass
        return f"s-{max_num + 1}"

    def _record_session(self, completed: bool) -> None:
        """Record the current working session."""
        now = datetime.now(timezone.utc).isoformat()
        session: dict[str, Any] = {
            "id": self.next_id(),
            "tag": self.current_tag or "Untitled",
            "category": "work",
            "started_at": self._current_session_start or now,
            "ended_at": now,
            "duration_sec": self.time_elapsed_sec,
            "completed": completed,
        }
        self.sessions.append(session)
        self.save()

    def _enter_phase(self, phase: Phase) -> None:
        """Transition to a new phase."""
        self.phase = phase
        self.paused = False
        self.current_tag = None
        self._current_session_start = None

        if phase == Phase.WORKING:
            self.time_remaining_sec = self.settings["work_duration_sec"]
            self.time_elapsed_sec = 0
        elif phase == Phase.SHORT_BREAK:
            self.time_remaining_sec = self.settings["short_break_sec"]
            self.time_elapsed_sec = 0
        elif phase == Phase.LONG_BREAK:
            self.time_remaining_sec = self.settings["long_break_sec"]
            self.time_elapsed_sec = 0
        elif phase == Phase.IDLE:
            self.time_remaining_sec = 0
            self.time_elapsed_sec = 0

    def _handle_phase_end(self) -> bool:
        """Handle timer reaching zero. Returns True (phase transition occurred)."""
        if self.phase == Phase.WORKING:
            self._record_session(completed=True)
            self.cycle_count += 1
            if self.cycle_count % self.settings["long_break_interval"] == 0:
                self._enter_phase(Phase.LONG_BREAK)
            else:
                self._enter_phase(Phase.SHORT_BREAK)
        elif self.phase in (Phase.SHORT_BREAK, Phase.LONG_BREAK):
            self._enter_phase(Phase.IDLE)
        return True

    # --- Stats ---

    def today_sessions(self) -> list[dict[str, Any]]:
        """Return sessions from today, most recent first."""
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today = [
            s for s in self.sessions
            if s.get("started_at", "").startswith(today_str)
        ]
        today.sort(key=lambda s: s.get("started_at", ""), reverse=True)
        return today

    def today_stats(self) -> dict[str, Any]:
        """Compute today's statistics."""
        today = self.today_sessions()
        completed = [s for s in today if s.get("completed")]
        total_focus_sec = sum(s.get("duration_sec", 0) for s in completed)

        # Streak: count consecutive days with at least one completed session
        from datetime import timedelta
        streak = 0
        best_streak = 0
        check_date = datetime.now(timezone.utc).date()
        all_dates = set()
        for s in self.sessions:
            if s.get("completed"):
                try:
                    dt = datetime.fromisoformat(s["started_at"].replace("Z", "+00:00"))
                    all_dates.add(dt.date())
                except (ValueError, KeyError):
                    pass

        while check_date in all_dates:
            streak += 1
            check_date -= timedelta(days=1)

        # Best streak (simple scan)
        if all_dates:
            sorted_dates = sorted(all_dates)
            current_run = 1
            best_streak = 1
            for i in range(1, len(sorted_dates)):
                if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
                    current_run += 1
                    best_streak = max(best_streak, current_run)
                else:
                    current_run = 1

        return {
            "today_completed": len(completed),
            "today_total_focus_min": total_focus_sec // 60,
            "streak_days": streak,
            "best_streak_days": best_streak,
        }

    def session_salience(self, session: dict[str, Any]) -> tuple[float, str]:
        """Compute salience and reason for a session based on age."""
        ended_at = session.get("ended_at", "")
        if not ended_at:
            return 0.2, "No end time"
        try:
            ended = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        except ValueError:
            return 0.2, "Unknown"
        now = datetime.now(timezone.utc)
        diff = now - ended
        minutes = diff.total_seconds() / 60
        hours = diff.total_seconds() / 3600

        if minutes < 60:
            return 0.6, f"Completed {int(minutes)} min ago"
        elif hours < 3:
            return 0.4, f"Completed {int(hours)}h ago"
        else:
            return 0.2, f"Completed {int(hours)}h ago"

    def format_time(self, seconds: int) -> str:
        """Format seconds as MM:SS."""
        m, s = divmod(max(0, seconds), 60)
        return f"{m:02d}:{s:02d}"

    def description(self) -> str:
        """Human description of current state for discovery."""
        if self.phase == Phase.IDLE:
            stats = self.today_stats()
            return f"Pomodoro timer: idle, {stats['today_completed']} sessions today"
        elif self.phase == Phase.WORKING:
            tag_part = f" on '{self.current_tag}'" if self.current_tag else ""
            return f"Working: {self.format_time(self.time_remaining_sec)} remaining{tag_part}"
        elif self.phase == Phase.SHORT_BREAK:
            return f"Short break: {self.format_time(self.time_remaining_sec)} remaining"
        elif self.phase == Phase.LONG_BREAK:
            return f"Long break: {self.format_time(self.time_remaining_sec)} remaining"
        return "Pomodoro timer"
