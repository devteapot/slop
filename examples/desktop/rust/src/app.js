// Pomodoro Timer — Tauri Frontend
// Vanilla JS, communicates with Rust backend via Tauri IPC

// ── Constants ──
const RING_CIRCUMFERENCE = 2 * Math.PI * 88; // r=88 in SVG
const POLL_INTERVAL_MS = 100;

// ── State ──
let prev = null; // previous snapshot JSON for diffing

// Tauri v2 invoke — works with __TAURI_INTERNALS__ (injected automatically)
function invoke(cmd, args = {}) {
  const internals = window.__TAURI_INTERNALS__;
  if (internals && internals.invoke) {
    return internals.invoke(cmd, args);
  }
  // Fallback for __TAURI__ (v1 style or with @tauri-apps/api)
  if (window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  return Promise.reject(new Error('Tauri IPC not available'));
}

// ── Helpers ──

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatSessionTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDuration(sec) {
  const m = Math.round(sec / 60);
  return `${m}m`;
}

function totalDuration(phase, settings) {
  switch (phase) {
    case 'working': return settings.work_duration_sec;
    case 'short_break': return settings.short_break_sec;
    case 'long_break': return settings.long_break_sec;
    default: return 0;
  }
}

function isBreak(phase) {
  return phase === 'short_break' || phase === 'long_break';
}

// ── DOM refs (lazy, grabbed on first render) ──
let statusLabel, tagDisplay, timerDigits, ringProgress, timerControls, sessionsTitle, sessionsList;

function ensureDom() {
  if (statusLabel) return;
  statusLabel = document.getElementById('status-label');
  tagDisplay = document.getElementById('tag-display');
  timerDigits = document.getElementById('timer-digits');
  ringProgress = document.getElementById('ring-progress');
  timerControls = document.getElementById('timer-controls');
  sessionsTitle = document.getElementById('sessions-title');
  sessionsList = document.getElementById('sessions-list');
}

// ── Render ──

function render(snap) {
  ensureDom();
  const json = JSON.stringify(snap);
  if (json === prev) return;
  prev = json;

  const { phase, paused, time_remaining_sec, current_tag, sessions, settings } = snap;

  // Status label
  statusLabel.textContent = paused ? 'PAUSED' : phase.toUpperCase().replace('_', ' ');
  statusLabel.className = 'status-label';
  if (paused) {
    statusLabel.classList.add('paused');
  } else if (phase === 'working') {
    statusLabel.classList.add('working');
  } else if (isBreak(phase)) {
    statusLabel.classList.add('break');
  }

  // Tag display
  if (phase === 'working' && current_tag) {
    tagDisplay.innerHTML = `<span class="tag-prefix">WORKING ON:</span><span class="tag-name">"${escapeHtml(current_tag)}"</span>`;
  } else if (isBreak(phase)) {
    const label = phase === 'short_break' ? 'SHORT BREAK' : 'LONG BREAK';
    tagDisplay.innerHTML = `<span class="tag-prefix">${label}</span><span class="tag-name">Take a break!</span>`;
  } else {
    tagDisplay.innerHTML = '';
  }

  // Timer digits
  if (phase === 'idle') {
    timerDigits.textContent = '00:00';
    timerDigits.className = 'timer-digits idle';
  } else {
    timerDigits.textContent = formatTime(time_remaining_sec);
    timerDigits.className = 'timer-digits';
  }

  // Ring progress
  const total = totalDuration(phase, settings);
  if (total > 0) {
    const elapsed = total - time_remaining_sec;
    const fraction = elapsed / total;
    const offset = RING_CIRCUMFERENCE * (1 - fraction);
    ringProgress.style.strokeDashoffset = offset;
    ringProgress.classList.toggle('break-mode', isBreak(phase));
  } else {
    ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE;
    ringProgress.classList.remove('break-mode');
  }

  // Controls
  renderControls(phase, paused);

  // Sessions
  renderSessions(sessions);
}

function renderControls(phase, paused) {
  let html = '';

  if (phase === 'idle') {
    html = `
      <form class="start-form" id="start-form">
        <input type="text" class="start-input" id="tag-input"
          placeholder="What are you working on?" />
        <button type="submit" class="btn btn-primary">START</button>
      </form>`;
  } else if (phase === 'working' && !paused) {
    html = `
      <button class="btn btn-secondary" onclick="doCommand('timer_pause')">PAUSE</button>
      <button class="btn btn-secondary" onclick="doCommand('timer_skip')">SKIP</button>
      <button class="btn btn-danger" onclick="doCommand('timer_stop')">STOP</button>`;
  } else if (paused) {
    html = `
      <button class="btn btn-primary" onclick="doCommand('timer_resume')">RESUME</button>
      <button class="btn btn-danger" onclick="doCommand('timer_stop')">STOP</button>`;
  } else if (isBreak(phase)) {
    html = `
      <button class="btn btn-secondary" onclick="doCommand('timer_skip')">SKIP</button>
      <button class="btn btn-danger" onclick="doCommand('timer_stop')">STOP</button>`;
  }

  timerControls.innerHTML = html;

  // Bind start form
  const form = document.getElementById('start-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('tag-input');
      const tag = input.value.trim() || null;
      await invoke('timer_start', { tag });
    });
  }
}

function renderSessions(sessions) {
  // Show all completed sessions (seed data may have different dates)
  const todaySessions = sessions.filter(s => s.completed);

  sessionsTitle.textContent = `TODAY: ${todaySessions.length} POMODORO${todaySessions.length !== 1 ? 'S' : ''}`;

  if (todaySessions.length === 0) {
    sessionsList.innerHTML = '<div class="empty-state">No sessions yet today</div>';
    return;
  }

  // Most recent first
  const sorted = [...todaySessions].reverse();

  sessionsList.innerHTML = sorted
    .map(s => `
      <div class="session-card">
        <span class="session-time">${formatSessionTime(s.started_at)}</span>
        <span class="session-tag">${escapeHtml(s.tag)}</span>
        <span class="session-category">#${escapeHtml(s.category)}</span>
        <span class="session-duration">${formatDuration(s.duration_sec)}</span>
      </div>`)
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Commands ──

async function doCommand(cmd) {
  try {
    await invoke(cmd);
  } catch (e) {
    console.error(`Command ${cmd} failed:`, e);
  }
}

// Expose to inline onclick handlers
window.doCommand = doCommand;

// ── Poll loop ──

async function poll() {
  try {
    const snap = await invoke('get_state');
    render(snap);
  } catch (e) {
    console.error('Poll error:', e);
  }
}

setInterval(poll, POLL_INTERVAL_MS);
poll();
