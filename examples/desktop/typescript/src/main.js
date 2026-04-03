const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOCKET_PATH = process.env.POMODORO_SOCK || "/tmp/slop/pomodoro.sock";
const DATA_FILE =
  process.env.POMODORO_FILE || path.join(os.homedir(), ".pomodoro", "sessions.json");
const SEED_FILE = path.join(__dirname, "..", "seed.json");
const DISCOVERY_DIR = path.join(os.homedir(), ".slop", "providers");
const DISCOVERY_FILE = path.join(DISCOVERY_DIR, "pomodoro.json");

const WORK_DURATION = 1500; // 25 min
const SHORT_BREAK = 300; // 5 min
const LONG_BREAK = 900; // 15 min
const LONG_BREAK_INTERVAL = 4;

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

let sessions = [];
let settings = {
  work_duration_sec: WORK_DURATION,
  short_break_sec: SHORT_BREAK,
  long_break_sec: LONG_BREAK,
  long_break_interval: LONG_BREAK_INTERVAL,
};

function loadSessions() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      sessions = data.sessions || [];
      if (data.settings) settings = { ...settings, ...data.settings };
      return;
    }
  } catch (error) {
    console.warn("[slop] failed to load pomodoro session data, falling back to seed:", error);
  }

  // Seed if no file exists
  try {
    if (fs.existsSync(SEED_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"));
      sessions = data.sessions || [];
      if (data.settings) settings = { ...settings, ...data.settings };
      saveSessions();
    }
  } catch (error) {
    console.warn("[slop] failed to seed pomodoro session data:", error);
  }
}

function saveSessions() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions, settings }, null, 2));
}

function nextSessionId() {
  let max = 0;
  for (const s of sessions) {
    const num = parseInt(s.id.replace("s-", ""), 10);
    if (num > max) max = num;
  }
  return `s-${max + 1}`;
}

function todaySessions() {
  const today = new Date().toISOString().slice(0, 10);
  return sessions.filter((s) => s.started_at && s.started_at.slice(0, 10) === today);
}

// ---------------------------------------------------------------------------
// Pomodoro state machine
// ---------------------------------------------------------------------------

let phase = "idle"; // idle | working | short_break | long_break
let paused = false;
let timeRemaining = 0;
let timeElapsed = 0;
let currentTag = null;
let pomodoroCount = 0; // completed pomodoros in current cycle (resets at long_break_interval)
let timerInterval = null;
let currentSessionStartedAt = null;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function startTimer(tag) {
  if (phase !== "idle") return;
  phase = "working";
  paused = false;
  timeRemaining = settings.work_duration_sec;
  timeElapsed = 0;
  currentTag = tag || null;
  currentSessionStartedAt = new Date().toISOString();
  startTicking();
  notifyRenderer();
  refreshSlop();
}

function pauseTimer() {
  if (paused || phase === "idle") return;
  paused = true;
  stopTicking();
  notifyRenderer();
  refreshSlop();
}

function resumeTimer() {
  if (!paused || phase === "idle") return;
  paused = false;
  startTicking();
  notifyRenderer();
  refreshSlop();
}

function skipTimer() {
  if (phase === "idle") return;
  if (phase === "working") {
    // Skip work — don't record session, go to break
    transitionFromWork(false);
  } else {
    // Skip break — go to idle
    phase = "idle";
    paused = false;
    timeRemaining = 0;
    timeElapsed = 0;
    currentTag = null;
    stopTicking();
  }
  notifyRenderer();
  refreshSlop();
}

function stopTimer() {
  if (phase === "idle") return;
  phase = "idle";
  paused = false;
  timeRemaining = 0;
  timeElapsed = 0;
  currentTag = null;
  currentSessionStartedAt = null;
  stopTicking();
  notifyRenderer();
  refreshSlop();
}

function tagTimer(label) {
  if (phase === "idle") return;
  currentTag = label;
  notifyRenderer();
  refreshSlop();
}

function tagSession(sessionId, label) {
  const s = sessions.find((x) => x.id === sessionId);
  if (s) {
    s.tag = label;
    saveSessions();
    refreshSlop();
  }
}

function deleteSession(sessionId) {
  const idx = sessions.findIndex((x) => x.id === sessionId);
  if (idx >= 0) {
    sessions.splice(idx, 1);
    saveSessions();
    refreshSlop();
  }
}

function transitionFromWork(completed) {
  if (completed && currentSessionStartedAt) {
    const now = new Date().toISOString();
    sessions.push({
      id: nextSessionId(),
      tag: currentTag || "Untitled",
      category: "work",
      started_at: currentSessionStartedAt,
      ended_at: now,
      duration_sec: settings.work_duration_sec,
      completed: true,
    });
    saveSessions();
  }
  pomodoroCount++;
  currentSessionStartedAt = null;

  if (pomodoroCount >= settings.long_break_interval) {
    phase = "long_break";
    timeRemaining = settings.long_break_sec;
    pomodoroCount = 0;
  } else {
    phase = "short_break";
    timeRemaining = settings.short_break_sec;
  }
  timeElapsed = 0;
  paused = false;
  currentTag = null;
  startTicking();
}

function transitionFromBreak() {
  phase = "idle";
  paused = false;
  timeRemaining = 0;
  timeElapsed = 0;
  currentTag = null;
  stopTicking();
}

function tick() {
  if (paused || phase === "idle") return;
  timeRemaining--;
  timeElapsed++;

  if (timeRemaining <= 0) {
    stopTicking();
    if (phase === "working") {
      transitionFromWork(true);
    } else {
      transitionFromBreak();
    }
  }
  notifyRenderer();
  refreshSlop();
}

function startTicking() {
  stopTicking();
  timerInterval = setInterval(tick, 1000);
}

function stopTicking() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function computeStats() {
  const today = todaySessions();
  const completedToday = today.filter((s) => s.completed);
  const totalFocusMin = Math.round(
    completedToday.reduce((a, s) => a + (s.duration_sec || 0), 0) / 60
  );

  // Streak: count consecutive days with at least 1 completed session
  const allDates = new Set(
    sessions
      .filter((s) => s.completed)
      .map((s) => s.started_at.slice(0, 10))
  );
  const todayStr = new Date().toISOString().slice(0, 10);
  let streak = 0;
  const d = new Date();
  while (true) {
    const dateStr = d.toISOString().slice(0, 10);
    if (allDates.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return {
    today_completed: completedToday.length,
    today_total_focus_min: totalFocusMin,
    streak_days: streak,
    best_streak_days: Math.max(streak, 7), // simplified
  };
}

// ---------------------------------------------------------------------------
// Renderer IPC
// ---------------------------------------------------------------------------

let mainWindow = null;

function notifyRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state-change", getState());
  }
}

function getState() {
  const stats = computeStats();
  const pomodorosUntilLong =
    settings.long_break_interval - (pomodoroCount % settings.long_break_interval);

  return {
    phase,
    paused,
    timeRemaining,
    timeElapsed,
    currentTag,
    pomodorosUntilLongBreak: pomodorosUntilLong,
    sessions: todaySessions().reverse(), // most recent first
    stats,
    settings,
  };
}

// ---------------------------------------------------------------------------
// SLOP provider
// ---------------------------------------------------------------------------

let slop = null;
let slopHandle = null;

async function startSlopProvider() {
  // Dynamic import for ESM packages
  const { SlopServer } = await import("@slop-ai/server");
  const { listenUnix } = await import("@slop-ai/server/unix");

  slop = new SlopServer({ id: "pomodoro", name: "Pomodoro Timer" });

  // Timer node — dynamic, returns different affordances based on state
  slop.register("timer", () => {
    const pomodorosUntilLong =
      settings.long_break_interval - (pomodoroCount % settings.long_break_interval);

    const props = {
      phase,
      paused,
      time_remaining_sec: timeRemaining,
      time_elapsed_sec: timeElapsed,
      current_tag: currentTag,
      pomodoros_until_long_break: pomodorosUntilLong,
    };

    const meta = {};
    const actions = {};

    if (phase === "idle") {
      meta.salience = 0.3;
      meta.reason = "Timer is idle";
      actions.start = {
        handler: async (params) => {
          startTimer(params?.tag);
          return { ok: true };
        },
        label: "Start pomodoro",
        description: "Start a 25-minute work session",
        params: {
          tag: {
            type: "string",
            description:
              "What you're working on (e.g. 'Code review', 'Write docs')",
          },
        },
        estimate: "instant",
      };
    } else if (phase === "working") {
      if (!paused) {
        meta.salience = 1.0;
        meta.urgency = "low";
        meta.focus = true;
        meta.reason = `Working: ${formatTime(timeRemaining)} remaining`;
        actions.pause = {
          handler: async () => { pauseTimer(); return { ok: true }; },
          label: "Pause timer",
          estimate: "instant",
        };
        actions.skip = {
          handler: async () => { skipTimer(); return { ok: true }; },
          label: "Skip to next phase",
          description:
            "Skip the current timer and advance to the next phase (work -> break, break -> idle)",
          estimate: "instant",
        };
        actions.stop = {
          handler: async () => { stopTimer(); return { ok: true }; },
          label: "Stop timer",
          description: "Abandon the current session and return to idle",
          dangerous: true,
          estimate: "instant",
        };
        actions.tag = {
          handler: async (params) => { tagTimer(params.label); return { ok: true }; },
          label: "Tag session",
          description: "Set or change the tag on the current session",
          params: {
            label: { type: "string", description: "Session label" },
          },
          estimate: "instant",
        };
      } else {
        // paused
        meta.salience = 0.8;
        meta.urgency = "low";
        meta.reason = `Paused at ${formatTime(timeRemaining)}`;
        actions.resume = {
          handler: async () => { resumeTimer(); return { ok: true }; },
          label: "Resume timer",
          estimate: "instant",
        };
        actions.stop = {
          handler: async () => { stopTimer(); return { ok: true }; },
          label: "Stop timer",
          description: "Abandon the current session and return to idle",
          dangerous: true,
          estimate: "instant",
        };
        actions.tag = {
          handler: async (params) => { tagTimer(params.label); return { ok: true }; },
          label: "Tag session",
          description: "Set or change the tag on the current session",
          params: {
            label: { type: "string", description: "Session label" },
          },
          estimate: "instant",
        };
      }
    } else {
      // short_break or long_break
      const breakType = phase === "long_break" ? "Long" : "Short";
      const breakMsg =
        phase === "long_break"
          ? "stretch and rest!"
          : "take a break!";
      if (!paused) {
        meta.salience = 0.9;
        meta.urgency = "medium";
        meta.reason = `${breakType} break: ${formatTime(timeRemaining)} remaining — ${breakMsg}`;
        actions.skip = {
          handler: async () => { skipTimer(); return { ok: true }; },
          label: "Skip to next phase",
          description:
            "Skip the current timer and advance to the next phase (work -> break, break -> idle)",
          estimate: "instant",
        };
        actions.stop = {
          handler: async () => { stopTimer(); return { ok: true }; },
          label: "Stop timer",
          description: "Abandon the current session and return to idle",
          dangerous: true,
          estimate: "instant",
        };
      } else {
        meta.salience = 0.8;
        meta.urgency = "low";
        meta.reason = `Paused at ${formatTime(timeRemaining)}`;
        actions.resume = {
          handler: async () => { resumeTimer(); return { ok: true }; },
          label: "Resume timer",
          estimate: "instant",
        };
        actions.stop = {
          handler: async () => { stopTimer(); return { ok: true }; },
          label: "Stop timer",
          description: "Abandon the current session and return to idle",
          dangerous: true,
          estimate: "instant",
        };
      }
    }

    return { type: "context", props, meta, actions };
  });

  // Sessions collection — dynamic
  slop.register("sessions", () => {
    const today = todaySessions();
    const items = sessions
      .slice()
      .reverse()
      .map((s) => {
        const ageSec = (Date.now() - new Date(s.ended_at).getTime()) / 1000;
        const ageMin = Math.round(ageSec / 60);
        const ageH = ageSec / 3600;
        let salience, reason;
        if (ageH < 1) {
          salience = 0.6;
          reason = `Completed ${ageMin} min ago`;
        } else if (ageH < 3) {
          salience = 0.4;
          reason = `Completed ${Math.round(ageH)}h ago`;
        } else {
          salience = 0.2;
          reason = `Completed ${Math.round(ageH)}h ago`;
        }

        return {
          id: s.id,
          props: {
            tag: s.tag,
            category: s.category,
            started_at: s.started_at,
            ended_at: s.ended_at,
            duration_sec: s.duration_sec,
            completed: s.completed,
          },
          meta: { salience, reason },
          actions: {
            tag: {
              handler: async (params) => {
                tagSession(s.id, params.label);
                return { ok: true };
              },
              label: "Re-tag session",
              params: {
                label: { type: "string" },
              },
              estimate: "instant",
            },
            delete: {
              handler: async () => {
                deleteSession(s.id);
                return { ok: true };
              },
              label: "Delete session",
              dangerous: true,
              estimate: "instant",
            },
          },
        };
      });

    return {
      type: "collection",
      props: {
        count: sessions.length,
        today_count: today.length,
      },
      summary: `${sessions.length} saved sessions, ${today.length} completed today`,
      items,
    };
  });

  // Stats context — dynamic
  slop.register("stats", () => {
    const stats = computeStats();
    return {
      type: "context",
      props: stats,
      meta: {
        summary: `${stats.today_completed} pomodoros today (${stats.today_total_focus_min} min focus), ${stats.streak_days}-day streak`,
      },
    };
  });

  // Start listening
  slopHandle = listenUnix(slop, SOCKET_PATH);

  // Write discovery file
  writeDiscovery();

  console.log(`SLOP: listening on ${SOCKET_PATH}`);
}

function refreshSlop() {
  if (slop) {
    slop.refresh();
    writeDiscovery();
  }
}

function writeDiscovery() {
  const desc =
    phase === "idle"
      ? `Pomodoro timer: idle, ${todaySessions().length} sessions today`
      : phase === "working"
      ? `Working: ${formatTime(timeRemaining)} remaining on '${currentTag || "Untitled"}'`
      : `${phase === "long_break" ? "Long" : "Short"} break: ${formatTime(timeRemaining)} remaining`;

  const descriptor = {
    id: "pomodoro",
    name: "Pomodoro Timer",
    version: "0.1.0",
    slop_version: "0.1",
    transport: { type: "unix", path: SOCKET_PATH },
    pid: process.pid,
    capabilities: ["state", "patches", "affordances", "attention"],
    description: desc,
  };

  try {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
    fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(descriptor, null, 2));
  } catch {}
}

function cleanupDiscovery() {
  try { fs.unlinkSync(DISCOVERY_FILE); } catch {}
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function setupIPC() {
  ipcMain.handle("get-state", () => getState());
  ipcMain.handle("start", (_e, tag) => { startTimer(tag); return getState(); });
  ipcMain.handle("pause", () => { pauseTimer(); return getState(); });
  ipcMain.handle("resume", () => { resumeTimer(); return getState(); });
  ipcMain.handle("skip", () => { skipTimer(); return getState(); });
  ipcMain.handle("stop", () => { stopTimer(); return getState(); });
  ipcMain.handle("tag", (_e, label) => { tagTimer(label); return getState(); });
}

// ---------------------------------------------------------------------------
// Electron app
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    backgroundColor: "#111319",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  loadSessions();
  setupIPC();
  createWindow();
  await startSlopProvider();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  cleanupDiscovery();
  if (slopHandle) slopHandle.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  cleanupDiscovery();
  if (slopHandle) slopHandle.close();
  stopTicking();
});

process.on("SIGINT", () => {
  cleanupDiscovery();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupDiscovery();
  process.exit(0);
});
