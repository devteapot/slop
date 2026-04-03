// ---------------------------------------------------------------------------
// Pomodoro Renderer — Vanilla JS
// Uses window.pomodoro API exposed by preload.js
// ---------------------------------------------------------------------------

const CIRCUMFERENCE = 2 * Math.PI * 88; // ring radius = 88

// DOM refs
const statusLabel = document.getElementById("status-label");
const tagDisplay = document.getElementById("tag-display");
const timerDigits = document.getElementById("timer-digits");
const ringProgress = document.getElementById("ring-progress");
const timerControls = document.getElementById("timer-controls");
const sessionsTitle = document.getElementById("sessions-title");
const sessionsList = document.getElementById("sessions-list");

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatSessionTime(isoString) {
  const d = new Date(isoString);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function formatDuration(sec) {
  return `${Math.round(sec / 60)}m`;
}

// ---------------------------------------------------------------------------
// Progress ring
// ---------------------------------------------------------------------------

function updateRing(timeRemaining, totalDuration, isBreak) {
  if (totalDuration <= 0) {
    ringProgress.style.strokeDashoffset = CIRCUMFERENCE;
    ringProgress.classList.remove("break-mode");
    return;
  }

  const elapsed = totalDuration - timeRemaining;
  const progress = elapsed / totalDuration;
  const offset = CIRCUMFERENCE * (1 - progress);
  ringProgress.style.strokeDashoffset = offset;

  if (isBreak) {
    ringProgress.classList.add("break-mode");
  } else {
    ringProgress.classList.remove("break-mode");
  }
}

// ---------------------------------------------------------------------------
// Status label
// ---------------------------------------------------------------------------

function updateStatusLabel(phase, paused) {
  statusLabel.className = "status-label";

  if (paused) {
    statusLabel.textContent = "PAUSED";
    statusLabel.classList.add("paused");
  } else if (phase === "idle") {
    statusLabel.textContent = "IDLE";
  } else if (phase === "working") {
    statusLabel.textContent = "WORKING";
    statusLabel.classList.add("working");
  } else if (phase === "short_break") {
    statusLabel.textContent = "SHORT BREAK";
    statusLabel.classList.add("break");
  } else if (phase === "long_break") {
    statusLabel.textContent = "LONG BREAK";
    statusLabel.classList.add("break");
  }
}

// ---------------------------------------------------------------------------
// Tag display
// ---------------------------------------------------------------------------

function updateTagDisplay(phase, currentTag) {
  if (phase === "working" && currentTag) {
    tagDisplay.innerHTML =
      `<span class="tag-prefix">WORKING ON:</span>` +
      `<span class="tag-name">"${escapeHtml(currentTag)}"</span>`;
  } else if (phase === "short_break" || phase === "long_break") {
    const label = phase === "long_break" ? "LONG BREAK" : "SHORT BREAK";
    tagDisplay.innerHTML = `<span class="tag-prefix">${label}</span>`;
  } else {
    tagDisplay.innerHTML = "";
  }
}

// ---------------------------------------------------------------------------
// Controls — state-dependent buttons
// ---------------------------------------------------------------------------

function updateControls(phase, paused) {
  timerControls.innerHTML = "";

  if (phase === "idle") {
    // Tag input + start button
    const form = document.createElement("div");
    form.className = "start-form";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "start-input";
    input.placeholder = "What are you working on?";
    input.id = "tag-input";

    const startBtn = createButton("START", "btn-primary", () => {
      const tag = input.value.trim() || undefined;
      window.pomodoro.start(tag);
    });

    // Allow Enter key to start
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const tag = input.value.trim() || undefined;
        window.pomodoro.start(tag);
      }
    });

    form.appendChild(input);
    form.appendChild(startBtn);
    timerControls.appendChild(form);
  } else if (phase === "working" && !paused) {
    timerControls.appendChild(createButton("PAUSE", "btn-secondary", () => window.pomodoro.pause()));
    timerControls.appendChild(createButton("SKIP", "btn-secondary", () => window.pomodoro.skip()));
    timerControls.appendChild(createButton("STOP", "btn-danger", () => window.pomodoro.stop()));
  } else if (paused) {
    timerControls.appendChild(createButton("RESUME", "btn-primary", () => window.pomodoro.resume()));
    timerControls.appendChild(createButton("STOP", "btn-danger", () => window.pomodoro.stop()));
  } else {
    // break (short_break or long_break), not paused
    timerControls.appendChild(createButton("SKIP", "btn-secondary", () => window.pomodoro.skip()));
    timerControls.appendChild(createButton("STOP", "btn-danger", () => window.pomodoro.stop()));
  }
}

function createButton(label, className, onClick) {
  const btn = document.createElement("button");
  btn.className = `btn ${className}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

// ---------------------------------------------------------------------------
// Sessions list
// ---------------------------------------------------------------------------

function updateSessions(sessions, stats) {
  // Stats header
  sessionsTitle.textContent = `TODAY: ${stats.today_completed} POMODORO${stats.today_completed !== 1 ? "S" : ""}`;

  // Session cards
  sessionsList.innerHTML = "";

  if (!sessions || sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No sessions yet today";
    sessionsList.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const card = document.createElement("div");
    card.className = "session-card";

    const time = document.createElement("span");
    time.className = "session-time";
    time.textContent = formatSessionTime(session.started_at);

    const tag = document.createElement("span");
    tag.className = "session-tag";
    tag.textContent = `"${session.tag}"`;

    const category = document.createElement("span");
    category.className = "session-category";
    category.textContent = `#${session.category}`;

    const duration = document.createElement("span");
    duration.className = "session-duration";
    duration.textContent = formatDuration(session.duration_sec);

    card.appendChild(time);
    card.appendChild(tag);
    card.appendChild(category);
    card.appendChild(duration);
    sessionsList.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Timer digits
// ---------------------------------------------------------------------------

function updateTimerDigits(phase, timeRemaining) {
  timerDigits.textContent = formatCountdown(timeRemaining);
  if (phase === "idle") {
    timerDigits.classList.add("idle");
  } else {
    timerDigits.classList.remove("idle");
  }
}

// ---------------------------------------------------------------------------
// Get total duration for progress calculation
// ---------------------------------------------------------------------------

function getTotalDuration(phase, settings) {
  if (phase === "working") return settings.work_duration_sec;
  if (phase === "short_break") return settings.short_break_sec;
  if (phase === "long_break") return settings.long_break_sec;
  return 0;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

let lastPhase = null;
let lastPaused = null;

function render(state) {
  const { phase, paused, timeRemaining, currentTag, sessions, stats, settings } = state;

  const isBreak = phase === "short_break" || phase === "long_break";
  const totalDuration = getTotalDuration(phase, settings);

  updateStatusLabel(phase, paused);
  updateTagDisplay(phase, currentTag);
  updateTimerDigits(phase, timeRemaining);
  updateRing(timeRemaining, totalDuration, isBreak);
  updateSessions(sessions, stats);

  // Only rebuild controls when phase or paused state changes to avoid
  // destroying input focus on every tick
  if (phase !== lastPhase || paused !== lastPaused) {
    updateControls(phase, paused);
    lastPhase = phase;
    lastPaused = paused;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  // Get initial state
  const state = await window.pomodoro.getState();
  render(state);

  // Listen for state changes from main process
  window.pomodoro.onStateChange((state) => {
    render(state);
  });
}

init();
