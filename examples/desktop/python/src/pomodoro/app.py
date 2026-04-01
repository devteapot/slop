"""PySide6 UI for the Pomodoro timer."""

from __future__ import annotations

import math
from typing import Any

from PySide6.QtCore import Qt, QRectF, Signal
from PySide6.QtGui import QColor, QFont, QFontDatabase, QPainter, QPen, QLinearGradient
from PySide6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from pomodoro.pomodoro import PomodoroTimer, Phase

# --- Colors (from DESIGN.md) ---
SURFACE = "#111319"
SURFACE_CONTAINER_LOW = "#191d27"
SURFACE_CONTAINER = "#1e2230"
PRIMARY = "#91db37"
PRIMARY_CONTAINER = "#6ba318"
SECONDARY = "#adc6ff"
ON_SURFACE = "#e2e2e5"
ON_SURFACE_VARIANT = "#c4c6cf"
ON_PRIMARY = "#111319"

# Phase-specific arc colors
PHASE_COLORS = {
    Phase.IDLE: "#4a4d57",
    Phase.WORKING: PRIMARY,
    Phase.SHORT_BREAK: SECONDARY,
    Phase.LONG_BREAK: "#d4a6ff",
}

PHASE_LABELS = {
    Phase.IDLE: "IDLE",
    Phase.WORKING: "WORKING",
    Phase.SHORT_BREAK: "SHORT BREAK",
    Phase.LONG_BREAK: "LONG BREAK",
}


class TimerArcWidget(QWidget):
    """Custom widget: circular progress arc with countdown text."""

    def __init__(self, timer: PomodoroTimer, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.timer = timer
        self.setFixedSize(220, 220)

    def paintEvent(self, event: Any) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        size = min(self.width(), self.height())
        margin = 16
        rect = QRectF(margin, margin, size - 2 * margin, size - 2 * margin)

        # Background track
        track_pen = QPen(QColor("#2a2d38"), 6)
        track_pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(track_pen)
        painter.drawArc(rect, 0, 360 * 16)

        # Progress arc
        if self.timer.phase != Phase.IDLE:
            phase = self.timer.phase
            color = QColor(PHASE_COLORS.get(phase, PRIMARY))

            # Compute progress
            if phase == Phase.WORKING:
                total = self.timer.settings["work_duration_sec"]
            elif phase == Phase.SHORT_BREAK:
                total = self.timer.settings["short_break_sec"]
            elif phase == Phase.LONG_BREAK:
                total = self.timer.settings["long_break_sec"]
            else:
                total = 1

            progress = self.timer.time_elapsed_sec / max(total, 1)
            progress = min(1.0, progress)

            arc_pen = QPen(color, 6)
            arc_pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            painter.setPen(arc_pen)

            # Qt arcs: start at 12 o'clock (90*16), go clockwise (negative span)
            start_angle = 90 * 16
            span_angle = -int(progress * 360 * 16)
            painter.drawArc(rect, start_angle, span_angle)

        # Countdown text
        time_str = self.timer.format_time(self.timer.time_remaining_sec)
        font = QFont("JetBrains Mono", 28, QFont.Weight.Bold)
        painter.setFont(font)
        painter.setPen(QColor(ON_SURFACE))
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, time_str)

        painter.end()


class SessionCard(QWidget):
    """A single session card in the list."""

    def __init__(self, session: dict[str, Any], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(52)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)

        # Time
        started = session.get("started_at", "")
        time_label = ""
        if started:
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                time_label = dt.strftime("%I:%M %p").lstrip("0")
            except ValueError:
                time_label = ""

        time_widget = QLabel(time_label)
        time_widget.setFont(QFont("JetBrains Mono", 10, QFont.Weight.Medium))
        time_widget.setStyleSheet(f"color: {ON_SURFACE_VARIANT}; background: transparent;")
        time_widget.setFixedWidth(70)
        layout.addWidget(time_widget)

        # Tag
        tag_widget = QLabel(session.get("tag", "Untitled"))
        tag_widget.setFont(QFont("Space Grotesk", 12, QFont.Weight.Normal))
        tag_widget.setStyleSheet(f"color: {ON_SURFACE}; background: transparent;")
        tag_widget.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        layout.addWidget(tag_widget)

        # Category
        category = session.get("category", "")
        if category:
            cat_widget = QLabel(f"#{category}")
            cat_widget.setFont(QFont("JetBrains Mono", 9, QFont.Weight.Medium))
            cat_widget.setStyleSheet(f"color: {SECONDARY}; background: transparent;")
            layout.addWidget(cat_widget)

        # Duration
        dur_sec = session.get("duration_sec", 0)
        dur_min = dur_sec // 60
        dur_widget = QLabel(f"{dur_min}m")
        dur_widget.setFont(QFont("JetBrains Mono", 10, QFont.Weight.Medium))
        dur_widget.setStyleSheet(f"color: {ON_SURFACE_VARIANT}; background: transparent;")
        layout.addWidget(dur_widget)


class PomodoroWindow(QMainWindow):
    """Main application window."""

    def __init__(self, timer: PomodoroTimer) -> None:
        super().__init__()
        self.timer = timer
        self.setWindowTitle("Pomodoro")
        self.setFixedSize(400, 620)
        self.setStyleSheet(self._build_stylesheet())

        central = QWidget()
        self.setCentralWidget(central)
        self._main_layout = QVBoxLayout(central)
        self._main_layout.setContentsMargins(20, 16, 20, 16)
        self._main_layout.setSpacing(0)

        # Title
        title = QLabel("POMODORO")
        title.setFont(QFont("JetBrains Mono", 11, QFont.Weight.Medium))
        title.setStyleSheet(f"color: {SECONDARY}; letter-spacing: 3px; background: transparent;")
        self._main_layout.addWidget(title)
        self._main_layout.addSpacing(12)

        # Phase + tag label
        self._phase_label = QLabel()
        self._phase_label.setFont(QFont("JetBrains Mono", 10, QFont.Weight.Medium))
        self._phase_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._phase_label.setStyleSheet(f"color: {ON_SURFACE_VARIANT}; background: transparent;")
        self._main_layout.addWidget(self._phase_label)

        # Tag label (current working tag)
        self._tag_label = QLabel()
        self._tag_label.setFont(QFont("Space Grotesk", 14, QFont.Weight.DemiBold))
        self._tag_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._tag_label.setStyleSheet(f"color: {ON_SURFACE}; background: transparent;")
        self._main_layout.addWidget(self._tag_label)
        self._main_layout.addSpacing(8)

        # Timer arc
        self._timer_arc = TimerArcWidget(timer)
        arc_container = QHBoxLayout()
        arc_container.addStretch()
        arc_container.addWidget(self._timer_arc)
        arc_container.addStretch()
        self._main_layout.addLayout(arc_container)
        self._main_layout.addSpacing(16)

        # Button row
        self._button_row = QHBoxLayout()
        self._button_row.setSpacing(8)
        self._button_container = QWidget()
        self._button_container.setLayout(self._button_row)
        self._main_layout.addWidget(self._button_container)
        self._main_layout.addSpacing(20)

        # Divider (subtle background shift, not a 1px line)
        divider = QWidget()
        divider.setFixedHeight(2)
        divider.setStyleSheet(f"background-color: {SURFACE_CONTAINER};")
        self._main_layout.addWidget(divider)
        self._main_layout.addSpacing(12)

        # Today header
        self._today_label = QLabel()
        self._today_label.setFont(QFont("JetBrains Mono", 10, QFont.Weight.Medium))
        self._today_label.setStyleSheet(f"color: {SECONDARY}; letter-spacing: 2px; background: transparent;")
        self._main_layout.addWidget(self._today_label)
        self._main_layout.addSpacing(8)

        # Session list (scrollable)
        self._scroll_area = QScrollArea()
        self._scroll_area.setWidgetResizable(True)
        self._scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._scroll_area.setStyleSheet(
            f"QScrollArea {{ background: transparent; border: none; }}"
            f"QScrollBar:vertical {{ background: {SURFACE}; width: 6px; border: none; }}"
            f"QScrollBar::handle:vertical {{ background: {SURFACE_CONTAINER}; border-radius: 3px; min-height: 20px; }}"
            f"QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}"
        )
        self._sessions_widget = QWidget()
        self._sessions_layout = QVBoxLayout(self._sessions_widget)
        self._sessions_layout.setContentsMargins(0, 0, 0, 0)
        self._sessions_layout.setSpacing(4)
        self._scroll_area.setWidget(self._sessions_widget)
        self._main_layout.addWidget(self._scroll_area, 1)

        # Stats bar at bottom
        self._main_layout.addSpacing(8)
        self._stats_label = QLabel()
        self._stats_label.setFont(QFont("JetBrains Mono", 9, QFont.Weight.Normal))
        self._stats_label.setStyleSheet(f"color: {ON_SURFACE_VARIANT}; background: transparent;")
        self._main_layout.addWidget(self._stats_label)

        self.update_ui()

    def update_ui(self) -> None:
        """Refresh all UI elements from timer state."""
        # Phase label
        phase_text = PHASE_LABELS.get(self.timer.phase, "")
        if self.timer.paused:
            phase_text += " (PAUSED)"
        self._phase_label.setText(phase_text)

        # Tag
        if self.timer.phase == Phase.WORKING and self.timer.current_tag:
            self._tag_label.setText(f'"{self.timer.current_tag}"')
            self._tag_label.setVisible(True)
        else:
            self._tag_label.setVisible(False)

        # Timer arc
        self._timer_arc.update()

        # Buttons
        self._rebuild_buttons()

        # Sessions
        self._rebuild_sessions()

        # Stats
        stats = self.timer.today_stats()
        self._stats_label.setText(
            f"{stats['today_completed']} pomodoros  |  "
            f"{stats['today_total_focus_min']} min focus  |  "
            f"{stats['streak_days']}-day streak"
        )

    def _rebuild_buttons(self) -> None:
        """Rebuild the button row based on current timer state."""
        # Clear existing buttons
        while self._button_row.count():
            child = self._button_row.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        self._button_row.addStretch()

        if self.timer.phase == Phase.IDLE:
            btn = self._make_button("START", primary=True)
            btn.clicked.connect(lambda: self._on_start())
            self._button_row.addWidget(btn)
        elif not self.timer.paused:
            if self.timer.phase == Phase.WORKING:
                pause_btn = self._make_button("PAUSE", primary=True)
                pause_btn.clicked.connect(lambda: self._on_pause())
                self._button_row.addWidget(pause_btn)

            skip_btn = self._make_button("SKIP", primary=False)
            skip_btn.clicked.connect(lambda: self._on_skip())
            self._button_row.addWidget(skip_btn)

            stop_btn = self._make_button("STOP", danger=True)
            stop_btn.clicked.connect(lambda: self._on_stop())
            self._button_row.addWidget(stop_btn)
        else:
            resume_btn = self._make_button("RESUME", primary=True)
            resume_btn.clicked.connect(lambda: self._on_resume())
            self._button_row.addWidget(resume_btn)

            stop_btn = self._make_button("STOP", danger=True)
            stop_btn.clicked.connect(lambda: self._on_stop())
            self._button_row.addWidget(stop_btn)

        self._button_row.addStretch()

    def _rebuild_sessions(self) -> None:
        """Rebuild the sessions list."""
        # Clear
        while self._sessions_layout.count():
            child = self._sessions_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        today = self.timer.today_sessions()
        self._today_label.setText(f"TODAY: {len(today)} POMODORO{'S' if len(today) != 1 else ''}")

        for session in today:
            card = SessionCard(session)
            card.setStyleSheet(
                f"background-color: {SURFACE_CONTAINER_LOW}; border-radius: 4px;"
            )
            self._sessions_layout.addWidget(card)

        self._sessions_layout.addStretch()

    def _make_button(
        self,
        text: str,
        primary: bool = False,
        danger: bool = False,
    ) -> QPushButton:
        btn = QPushButton(text)
        btn.setFont(QFont("JetBrains Mono", 10, QFont.Weight.Medium))
        btn.setFixedHeight(36)
        btn.setMinimumWidth(80)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)

        if danger:
            btn.setStyleSheet(
                f"QPushButton {{ background-color: #3d2020; color: #ff6b6b; border: none; "
                f"border-radius: 4px; padding: 8px 16px; font-family: 'JetBrains Mono'; }}"
                f"QPushButton:hover {{ background-color: #4d2828; }}"
            )
        elif primary:
            btn.setStyleSheet(
                f"QPushButton {{ background-color: {PRIMARY}; color: {ON_PRIMARY}; border: none; "
                f"border-radius: 4px; padding: 8px 16px; font-family: 'JetBrains Mono'; font-weight: 500; }}"
                f"QPushButton:hover {{ background-color: #a3ef4a; }}"
            )
        else:
            btn.setStyleSheet(
                f"QPushButton {{ background-color: {SURFACE_CONTAINER}; color: {ON_SURFACE}; border: none; "
                f"border-radius: 4px; padding: 8px 16px; font-family: 'JetBrains Mono'; }}"
                f"QPushButton:hover {{ background-color: #282c3a; }}"
            )
        return btn

    # --- Button handlers ---

    def _on_start(self) -> None:
        self.timer.start()
        self.update_ui()

    def _on_pause(self) -> None:
        self.timer.pause()
        self.update_ui()

    def _on_resume(self) -> None:
        self.timer.resume()
        self.update_ui()

    def _on_skip(self) -> None:
        self.timer.skip()
        self.update_ui()

    def _on_stop(self) -> None:
        self.timer.stop()
        self.update_ui()

    # --- Stylesheet ---

    def _build_stylesheet(self) -> str:
        return f"""
            QMainWindow {{
                background-color: {SURFACE};
            }}
            QWidget {{
                background-color: transparent;
            }}
            QLabel {{
                color: {ON_SURFACE};
                background: transparent;
            }}
        """
