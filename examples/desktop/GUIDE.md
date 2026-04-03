# Guide: Exploring the Pomodoro Timer

This guide walks you through using the Pomodoro desktop app in both normal GUI mode and SLOP mode, so you can see exactly what an AI observes when a native desktop app is running.

## Setup

Pick any implementation and build it:

```bash
# TypeScript (Electron)
cd examples/desktop/typescript && bun install

# Python (PySide6)
cd examples/desktop/python && pip install -e .

# Go (Fyne)
cd examples/desktop/go && go build -o pomodoro .

# Rust (Tauri)
cd examples/desktop/rust/src-tauri && cargo build
```

Seed the data file with sample sessions:

```bash
mkdir -p ~/.pomodoro
cp seed.json ~/.pomodoro/sessions.json
```

## Part 1: Normal mode

This is what a human sees. A desktop Pomodoro timer with a visual countdown.

### Launch the app

```bash
# TypeScript
cd examples/desktop/typescript && bunx electron .

# Python
cd examples/desktop/python && python -m pomodoro

# Go
cd examples/desktop/go && ./pomodoro

# Rust
cd examples/desktop/rust/src-tauri && ./target/debug/pomodoro
```

The window opens with a dark background, a large timer display in the center, and a list of today's completed sessions below it.

### Start a pomodoro

Click **START** in the GUI. A text field lets you tag what you're working on — type "Write docs" and confirm. The circular progress arc fills in neon green as the 25-minute countdown begins. The large digits in the center tick down: `24:59`, `24:58`, ...

### Pause and resume

Click **PAUSE**. The countdown freezes. The digits stop moving. Click **RESUME** — the countdown picks up where it left off.

### Skip and stop

**SKIP** advances to the next phase — if you're working, it jumps to a break (without recording a completed session). If you're on break, it returns to idle.

**STOP** abandons the current session entirely and returns to idle.

### View completed sessions

Below the timer, you see today's completed sessions as cards:

```
TODAY: 4 POMODOROS

 3:45 PM  "Code review"      #work      25m
 2:15 PM  "Write docs"       #docs      25m
12:30 PM  "Implement SDK"    #work      25m
10:00 AM  "Morning standup"  #meetings  25m
```

### Stats

The app tracks your daily completed count, total focus minutes, and streak days. These appear in the UI header or footer depending on the implementation.

---

Everything above is a normal desktop app. Nothing special — a timer, some buttons, a history list. Now let's see what an AI sees.

## Part 2: SLOP mode

Desktop apps are always SLOP providers. There is no `--slop` flag — the Unix socket listener starts automatically when the app launches. The moment you open the Pomodoro window, an AI can connect.

### Discovery

While the app is running, check the discovery directory:

```bash
cat ~/.slop/providers/pomodoro.json
```

```json
{
  "id": "pomodoro",
  "name": "Pomodoro Timer",
  "version": "0.1.0",
  "slop_version": "0.1",
  "transport": { "type": "unix", "path": "/tmp/slop/pomodoro.sock" },
  "pid": 48291,
  "capabilities": ["state", "patches", "affordances", "attention"],
  "description": "Pomodoro timer: idle, 4 sessions today"
}
```

Any AI agent scanning `~/.slop/providers/` finds the Pomodoro timer, sees what it's doing ("idle, 4 sessions today"), and knows how to connect. When the app quits, this file is cleaned up.

The description updates dynamically. Start a pomodoro and check again:

```bash
cat ~/.slop/providers/pomodoro.json | grep description
```

```
"description": "Working: 24:37 remaining on 'Write docs'"
```

### Connect with a SLOP consumer

In another terminal, connect to the socket:

```bash
echo '{"type":"subscribe","id":"s1","path":"/","depth":-1}' | socat - UNIX-CONNECT:/tmp/slop/pomodoro.sock
```

The provider sends a **hello** message on connection, then responds to subscribe with a **snapshot** — the entire state tree as structured JSON.

### The snapshot: what the AI sees

```json
{
  "type": "snapshot",
  "id": "s1",
  "version": 1,
  "tree": {
    "id": "pomodoro",
    "type": "root",
    "properties": { "version": "0.1.0" },
    "children": [
      {
        "id": "timer",
        "type": "context",
        "properties": {
          "phase": "idle",
          "paused": false,
          "time_remaining_sec": 0,
          "time_elapsed_sec": 0,
          "current_tag": null,
          "pomodoros_until_long_break": 4
        },
        "meta": { "salience": 0.3, "reason": "Timer is idle" },
        "affordances": [
          { "action": "start", "label": "Start pomodoro", "params": { ... } }
        ]
      },
      {
        "id": "sessions",
        "type": "collection",
        "properties": { "count": 4, "today_count": 4 },
        "meta": { "summary": "4 pomodoros completed today", "total_children": 4 },
        "children": [
          {
            "id": "s-4",
            "type": "item",
            "properties": {
              "tag": "Code review",
              "category": "work",
              "started_at": "2026-04-01T15:45:00Z",
              "duration_sec": 1500,
              "completed": true
            },
            "meta": { "salience": 0.6, "reason": "Completed 49 min ago" },
            "affordances": [
              { "action": "tag", "label": "Re-tag session" },
              { "action": "delete", "label": "Delete session", "dangerous": true }
            ]
          }
        ]
      },
      {
        "id": "stats",
        "type": "context",
        "properties": {
          "today_completed": 4,
          "today_total_focus_min": 100,
          "streak_days": 3,
          "best_streak_days": 7
        },
        "meta": { "summary": "4 pomodoros today (100 min focus), 3-day streak" }
      }
    ]
  }
}
```

### Side by side: human vs AI

This is the key difference. Compare:

**You see (GUI):**

A dark window with a large `0:00` display, a green START button, and four session cards below.

**The AI sees (JSON tree):**

```json
{
  "id": "timer",
  "properties": { "phase": "idle", "paused": false, "time_remaining_sec": 0 },
  "meta": { "salience": 0.3, "reason": "Timer is idle" },
  "affordances": [{ "action": "start", "params": { "tag": { "type": "string" } } }]
}
```

The AI knows:
- The timer is **idle** (salience 0.3 — not very interesting right now)
- It can **start** a pomodoro and optionally tag it
- There are **4 completed sessions** today with 100 minutes of focus
- The most recent session ("Code review") has salience 0.6 — it happened recently

The AI doesn't scrape pixels from the window. It doesn't guess what buttons exist. It reads structured state and acts through declared affordances.

### Invoke an action via SLOP

Start a pomodoro from the socket:

```bash
echo '{"type":"invoke","id":"inv-1","path":"/timer","action":"start","params":{"tag":"Write tests"}}' \
  | socat - UNIX-CONNECT:/tmp/slop/pomodoro.sock
```

The provider responds:

```json
{"type":"result","id":"inv-1","status":"ok","data":{"ok":true}}
```

In the GUI window, the timer starts counting down. The tag "Write tests" appears above the timer. The START button is replaced by PAUSE, SKIP, and STOP.

### Watch timer ticks stream as patches

While the timer is running, every second the provider sends a patch:

```json
{
  "type": "patch",
  "subscription": "s1",
  "version": 42,
  "ops": [
    { "op": "replace", "path": "/children/timer/properties/time_remaining_sec", "value": 1477 },
    { "op": "replace", "path": "/children/timer/properties/time_elapsed_sec", "value": 23 },
    { "op": "replace", "path": "/children/timer/meta/reason", "value": "Working: 24:37 remaining" }
  ]
}
```

This is unique to the desktop Pomodoro example. The CLI task manager sends patches when you add or complete tasks — discrete events. The Pomodoro timer sends a continuous stream of patches, one per second, as the countdown ticks. An AI consumer watching the socket sees the timer count down in real time.

### Salience model

The AI uses salience to decide what matters:

| Context | Salience | Why |
|---|---|---|
| Active work timer | 1.0 | You're focused — the timer is the most important thing |
| Paused timer | 0.8 | Something interrupted you |
| Break timer | 0.9 | You should be resting, not working |
| Idle timer | 0.3 | Nothing happening |
| Session (< 1h ago) | 0.6 | Recent, still relevant |
| Session (1-3h ago) | 0.4 | Fading from relevance |
| Session (3h+ ago) | 0.2 | Old news |

Sessions have decreasing salience — the most recent session appears first and carries the highest salience. An AI with a tight context window could filter to `min_salience: 0.5` and only see the active timer and recent sessions.

## Part 3: Side by side

This is the key value proposition. Run the desktop app and connect an AI consumer simultaneously.

**Terminal 1** — launch the desktop app:

```bash
cd examples/desktop/typescript && bunx electron .
```

The GUI window opens. The SLOP socket is already listening.

**Terminal 2** — connect as an AI consumer:

```bash
socat - UNIX-CONNECT:/tmp/slop/pomodoro.sock
```

You receive the hello message. Subscribe to the full tree:

```
{"type":"subscribe","id":"s1","path":"/","depth":-1}
```

You receive the snapshot. Now interact through both interfaces:

### Start from the GUI, observe from the socket

Click START in the GUI window. Type "Sprint planning" as the tag. In Terminal 2, you immediately see a patch:

```json
{
  "type": "patch",
  "ops": [
    { "op": "replace", "path": "/children/timer/properties/phase", "value": "working" },
    { "op": "replace", "path": "/children/timer/properties/time_remaining_sec", "value": 1500 },
    { "op": "replace", "path": "/children/timer/properties/current_tag", "value": "Sprint planning" }
  ]
}
```

Then a stream of per-second patches as the timer ticks down.

### Pause from the socket, observe in the GUI

In Terminal 2, send:

```
{"type":"invoke","id":"inv-pause","path":"/timer","action":"pause","params":{}}
```

In the GUI window, the timer freezes. The PAUSE button changes to RESUME. The AI and the human see the same state change, from different directions.

### Resume from the GUI, stop from the socket

Click RESUME in the GUI — the socket sees `paused: false`. Send a stop from Terminal 2:

```
{"type":"invoke","id":"inv-stop","path":"/timer","action":"stop","params":{}}
```

The GUI returns to idle. Timer reads `0:00`. START button reappears.

---

**This is the point.** There is no "AI version" of the Pomodoro app. There's one process, one timer, one set of sessions. The human uses the GUI window — buttons, countdown animation, session cards. The AI uses the Unix socket — JSON tree, affordances, patches. Both interfaces operate on the same state. SLOP is just a structured window into what's already there.

The transport is different from the CLI example (Unix socket is always on, no `--slop` flag needed), but the protocol is identical. Same tree structure, same affordances, same patches. A desktop app, a CLI tool, a web app — they all speak the same SLOP.
