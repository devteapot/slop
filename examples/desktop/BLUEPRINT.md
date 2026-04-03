# Desktop Blueprint: `pomodoro` — A Pomodoro Timer

A desktop Pomodoro timer that helps users manage focused work sessions using the Pomodoro Technique. It runs as a native desktop app with a visual countdown, session tagging, and daily session history. The app is always a SLOP provider — an AI consumer can observe timer state, start/pause sessions, and read session history through a Unix socket, demonstrating that desktop GUI apps are first-class SLOP providers.

## What this demonstrates

| SLOP feature | How it's used |
|---|---|
| **State tree** (spec 02) | Timer state, session history, daily stats as a structured tree |
| **Unix socket transport** (spec 03) | Local desktop IPC via NDJSON over Unix domain socket |
| **Discovery** (spec 03) | Registers in `~/.slop/providers/pomodoro.json` on launch |
| **Affordances + params** (spec 05) | start/pause/resume/skip/stop/tag actions, state-dependent availability |
| **Salience & urgency** (spec 06) | Active timer = high salience; break reminders = urgency; idle = low salience |
| **Dynamic affordances** (spec 05) | Available actions change based on timer phase (idle vs running vs paused vs break) |

## App behavior

### Visual design (all implementations)

Following DESIGN.md:
- **Background**: `#111319` (surface)
- **Accent**: `#91db37` (neon green) for active timer ring, primary buttons
- **Secondary**: `#adc6ff` for labels and secondary text
- **Typography**: Space Grotesk for headings/body, JetBrains Mono for timer digits and labels
- **Timer display**: Large centered countdown (JetBrains Mono, 700 weight), with a circular progress arc in neon green
- **Session list**: Cards on `surface_container_low` (`#191d27`), no borders, gap-separated
- **Buttons**: Sharp corners (4px), neon green primary, glassmorphic secondary
- **No 1px borders anywhere**

### UI layout

```
+----------------------------------------------+
|  POMODORO                          [--] [x]  |
|----------------------------------------------|
|                                              |
|              WORKING ON:                     |
|          "Implement SLOP SDK"                |
|                                              |
|              ╭─────────╮                     |
|             │  24:37   │                     |
|              ╰─────────╯                     |
|          (circular progress arc)             |
|                                              |
|     [ PAUSE ]   [ SKIP ]   [ STOP ]         |
|                                              |
|  ─────────────────────────────────────────── |
|  TODAY: 4 POMODOROS                          |
|                                              |
|  ┌ 3:45 PM  "Code review"     #work    25m ┐|
|  ┌ 2:15 PM  "Write docs"      #docs    25m ┐|
|  ┌12:30 PM  "Implement SDK"   #work    25m ┐|
|  ┌10:00 AM  "Morning standup" #meetings 25m┐|
+----------------------------------------------+
```

### State machine

```
        start(tag?)
  IDLE ──────────> WORKING
   ^                  │
   │ stop()           │ timer ends (25 min)
   │                  v
   │              SHORT_BREAK (after 1st, 2nd, 3rd pomodoro)
   │              LONG_BREAK  (after every 4th pomodoro)
   │                  │
   │                  │ timer ends (5 min / 15 min)
   │                  v
   └──────────────── IDLE

  Any running state can be:
    - pause() → PAUSED (sub-state, preserves phase)
    - resume() → back to previous running state
    - skip() → advance to next phase
    - stop() → back to IDLE (abandons current)
```

### Launch behavior

1. App window opens with the Pomodoro UI
2. SLOP socket listener starts on `/tmp/slop/pomodoro.sock`
3. Discovery file written to `~/.slop/providers/pomodoro.json`
4. Seed data loaded if `~/.pomodoro/sessions.json` doesn't exist
5. On quit: socket closed, discovery file removed

## Data model

Sessions stored in `~/.pomodoro/sessions.json`:

```json
{
  "sessions": [
    {
      "id": "s-1",
      "tag": "Implement SLOP SDK",
      "category": "work",
      "started_at": "2026-04-01T10:00:00Z",
      "ended_at": "2026-04-01T10:25:00Z",
      "duration_sec": 1500,
      "completed": true
    }
  ],
  "settings": {
    "work_duration_sec": 1500,
    "short_break_sec": 300,
    "long_break_sec": 900,
    "long_break_interval": 4
  }
}
```

Default path: `~/.pomodoro/sessions.json`. Override with `POMODORO_FILE` env var.

## SLOP tree

This is the exact tree structure the provider must expose. Node IDs, types, properties, and affordances are the **contract** — all implementations must produce this same tree.

### When idle (no active timer)

```
[root] pomodoro
  properties: { version: "0.1.0" }
  │
  ├── [context] timer
  │   properties: {
  │     phase: "idle",
  │     paused: false,
  │     time_remaining_sec: 0,
  │     time_elapsed_sec: 0,
  │     current_tag: null,
  │     pomodoros_until_long_break: 4
  │   }
  │   meta: { salience: 0.3, reason: "Timer is idle" }
  │   affordances: [
  │     start(tag?: string)
  │   ]
  │
  ├── [collection] sessions
  │   properties: { count: 4, today_count: 4 }
  │   meta: {
  │     summary: "4 pomodoros completed today",
  │     total_children: 4
  │   }
  │   │
  │   ├── [item] s-4                    ← most recent first
  │   │   properties: {
  │   │     tag: "Code review",
  │   │     category: "work",
  │   │     started_at: "2026-04-01T15:45:00Z",
  │   │     ended_at: "2026-04-01T16:10:00Z",
  │   │     duration_sec: 1500,
  │   │     completed: true
  │   │   }
  │   │   meta: { salience: 0.6, reason: "Completed 49 min ago" }
  │   │   affordances: [tag(label: string), delete()]
  │   │
  │   ├── [item] s-3
  │   │   properties: { tag: "Write docs", category: "docs", ... }
  │   │   meta: { salience: 0.4, reason: "Completed 2h ago" }
  │   │   affordances: [tag(label: string), delete()]
  │   │
  │   ├── [item] s-2
  │   │   meta: { salience: 0.3 }
  │   │
  │   └── [item] s-1
  │       meta: { salience: 0.2 }
  │
  └── [context] stats
      properties: {
        today_completed: 4,
        today_total_focus_min: 100,
        streak_days: 3,
        best_streak_days: 7
      }
      meta: { summary: "4 pomodoros today (100 min focus), 3-day streak" }
```

### When working (active timer)

```
  ├── [context] timer
  │   properties: {
  │     phase: "working",
  │     paused: false,
  │     time_remaining_sec: 1477,
  │     time_elapsed_sec: 23,
  │     current_tag: "Implement SLOP SDK",
  │     pomodoros_until_long_break: 3
  │   }
  │   meta: {
  │     salience: 1.0,
  │     urgency: "low",
  │     focus: true,
  │     reason: "Working: 24:37 remaining"
  │   }
  │   affordances: [
  │     pause(),
  │     skip(),
  │     stop(),
  │     tag(label: string)
  │   ]
```

### When on break

```
  ├── [context] timer
  │   properties: {
  │     phase: "short_break",     ← or "long_break"
  │     paused: false,
  │     time_remaining_sec: 247,
  │     time_elapsed_sec: 53,
  │     current_tag: null,
  │     pomodoros_until_long_break: 3
  │   }
  │   meta: {
  │     salience: 0.9,
  │     urgency: "medium",
  │     reason: "Short break: 4:07 remaining — take a break!"
  │   }
  │   affordances: [
  │     skip(),
  │     stop()
  │   ]
```

### When paused

```
  ├── [context] timer
  │   properties: {
  │     phase: "working",         ← preserves the phase that was paused
  │     paused: true,
  │     time_remaining_sec: 1477, ← frozen
  │     time_elapsed_sec: 23,     ← frozen
  │     current_tag: "Implement SLOP SDK",
  │     pomodoros_until_long_break: 3
  │   }
  │   meta: {
  │     salience: 0.8,
  │     urgency: "low",
  │     reason: "Paused at 24:37"
  │   }
  │   affordances: [
  │     resume(),
  │     stop(),
  │     tag(label: string)
  │   ]
```

### State-dependent affordances summary

| Phase | paused | Affordances on `timer` |
|---|---|---|
| idle | false | `start(tag?)` |
| working | false | `pause()`, `skip()`, `stop()`, `tag(label)` |
| working | true | `resume()`, `stop()`, `tag(label)` |
| short_break | false | `skip()`, `stop()` |
| long_break | false | `skip()`, `stop()` |
| short_break | true | `resume()`, `stop()` |
| long_break | true | `resume()`, `stop()` |

### Salience model

| Context | Salience | Urgency | Reason pattern |
|---|---|---|---|
| Active work timer | 1.0 | low | "Working: MM:SS remaining" |
| Paused work timer | 0.8 | low | "Paused at MM:SS" |
| Short break | 0.9 | medium | "Short break: MM:SS remaining — take a break!" |
| Long break | 0.9 | medium | "Long break: MM:SS remaining — stretch and rest!" |
| Idle | 0.3 | none | "Timer is idle" |
| Session (< 1h ago) | 0.6 | none | "Completed N min ago" |
| Session (1-3h ago) | 0.4 | none | "Completed Nh ago" |
| Session (3h+ ago) | 0.2 | none | "Completed Nh ago" |

## Affordance schemas

### Timer node affordances

```json
[
  {
    "action": "start",
    "label": "Start pomodoro",
    "description": "Start a 25-minute work session",
    "params": {
      "type": "object",
      "properties": {
        "tag": {
          "type": "string",
          "description": "What you're working on (e.g. 'Code review', 'Write docs')"
        }
      }
    },
    "estimate": "instant"
  },
  {
    "action": "pause",
    "label": "Pause timer",
    "estimate": "instant"
  },
  {
    "action": "resume",
    "label": "Resume timer",
    "estimate": "instant"
  },
  {
    "action": "skip",
    "label": "Skip to next phase",
    "description": "Skip the current timer and advance to the next phase (work → break, break → idle)",
    "estimate": "instant"
  },
  {
    "action": "stop",
    "label": "Stop timer",
    "description": "Abandon the current session and return to idle",
    "dangerous": true,
    "estimate": "instant"
  },
  {
    "action": "tag",
    "label": "Tag session",
    "description": "Set or change the tag on the current session",
    "params": {
      "type": "object",
      "properties": {
        "label": { "type": "string", "description": "Session label" }
      },
      "required": ["label"]
    },
    "estimate": "instant"
  }
]
```

### Session item affordances

```json
[
  {
    "action": "tag",
    "label": "Re-tag session",
    "params": {
      "type": "object",
      "properties": {
        "label": { "type": "string" }
      },
      "required": ["label"]
    },
    "estimate": "instant"
  },
  {
    "action": "delete",
    "label": "Delete session",
    "dangerous": true,
    "estimate": "instant"
  }
]
```

## Interactions

### 1. AI reads the timer state (read-only)

```
Consumer subscribes → receives snapshot
AI sees: timer.phase = "working", time_remaining_sec = 1477, current_tag = "Implement SLOP SDK"
AI sees: stats.today_completed = 4, stats.today_total_focus_min = 100
AI can answer: "You're working on 'Implement SLOP SDK' with 24:37 left. You've done 4 pomodoros today (100 min of focus)."
```

### 2. AI starts a work session

```
AI sees: timer.phase = "idle", affordances include start(tag?)
AI invokes: start({ tag: "Write tests" }) on /timer
Provider: starts 25-min countdown, creates pending session
Consumer receives: patch — timer.phase → "working", time_remaining_sec → 1500, current_tag → "Write tests"
AI sees: affordances changed to [pause, skip, stop, tag]
```

### 3. AI pauses and resumes

```
AI sees: timer.phase = "working", paused = false
AI invokes: pause() on /timer
Provider: freezes countdown
Consumer receives: patch — timer.paused → true, affordances change to [resume, stop, tag]

Later:
AI invokes: resume() on /timer
Provider: resumes countdown
Consumer receives: patch — timer.paused → false, affordances change back to [pause, skip, stop, tag]
```

### 4. Timer completes naturally (provider-initiated update)

```
Timer reaches 0 during "working" phase
Provider: records completed session, transitions to short_break, starts 5-min countdown
Consumer receives: patch —
  timer.phase → "short_break", time_remaining_sec → 300
  timer.meta.urgency → "medium", timer.meta.reason → "Short break: 5:00 remaining — take a break!"
  new session item appears in /sessions
  stats.today_completed increments
```

### 5. AI skips a break

```
AI sees: timer.phase = "short_break", time_remaining_sec = 182
AI invokes: skip() on /timer
Provider: cancels break timer, transitions to idle
Consumer receives: patch — timer.phase → "idle", affordances → [start]
```

### 6. AI tags a session after completion

```
AI sees: session s-4 with tag "untitled"
AI invokes: tag({ label: "Sprint planning" }) on /sessions/s-4
Provider: updates session tag, writes to disk
Consumer receives: patch — s-4.properties.tag → "Sprint planning"
```

## Implementation constraints

| Language | Framework | SDK package | Binary/app name |
|---|---|---|---|
| TypeScript | Electron | `@slop-ai/server` | `pomodoro` (Electron app) |
| Rust | Tauri v2 | `slop_ai` (crate) | `pomodoro` (Tauri app) |
| Python | PySide6 | `slop` (packages/python/slop-ai) | `pomodoro` (Python script) |
| Go | Fyne | `slop` (packages/go/slop-ai) | `pomodoro` (Go binary) |

- **Transport**: Unix domain socket, NDJSON
- **Socket path**: `/tmp/slop/pomodoro.sock` (override with `POMODORO_SOCK` env var)
- **Discovery file**: `~/.slop/providers/pomodoro.json`
- **Data file**: `~/.pomodoro/sessions.json` (override with `POMODORO_FILE` env var)
- **Timer tick**: Update tree every 1 second while timer is running (debounce patches to every 1s)
- **Seed data**: ship with a `seed.json` containing 4 sample sessions from "today"

## File structure per implementation

```
examples/desktop/typescript/
├── README.md
├── package.json
├── seed.json
├── src/
│   ├── main.ts            # Electron main process + SLOP provider
│   ├── preload.ts
│   ├── renderer/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   └── pomodoro.ts        # Timer state machine + session store

examples/desktop/rust/
├── README.md
├── Cargo.toml
├── seed.json
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── pomodoro.rs    # Timer state machine + session store
│   │   └── provider.rs    # SLOP tree registration
│   └── Cargo.toml
├── src/                   # Web frontend
│   ├── index.html
│   ├── app.js
│   └── styles.css

examples/desktop/python/
├── README.md
├── pyproject.toml
├── seed.json
└── src/
    ├── __main__.py        # Entry point
    ├── app.py             # PySide6 window + widgets
    ├── pomodoro.py        # Timer state machine + session store
    └── provider.py        # SLOP tree registration

examples/desktop/go/
├── README.md
├── go.mod
├── seed.json
├── main.go                # Entry point + Fyne app
├── pomodoro.go            # Timer state machine + session store
└── provider.go            # SLOP tree registration
```

## SLOP mode behavior

Desktop apps are always SLOP providers (no `--slop` flag needed — the socket starts on launch).

1. **Start socket listener** on `/tmp/slop/pomodoro.sock` at app launch
2. **Write discovery file** to `~/.slop/providers/pomodoro.json`:
   ```json
   {
     "id": "pomodoro",
     "name": "Pomodoro Timer",
     "version": "0.1.0",
     "slop_version": "0.1",
     "transport": { "type": "unix", "path": "/tmp/slop/pomodoro.sock" },
     "pid": 12345,
     "capabilities": ["state", "patches", "affordances", "attention"],
     "description": "Pomodoro timer: idle, 4 sessions today"
   }
   ```
3. **Update description dynamically** — when timer state changes, update the discovery file description (e.g., "Working: 24:37 remaining on 'Implement SLOP SDK'")
4. **Refresh tree every 1 second** while timer is running — send patches with updated `time_remaining_sec` and `time_elapsed_sec`
5. **On quit**: delete socket file, delete discovery file

## Cross-SDK alignment notes

1. **Affordances go on the timer node, not root (spec 05).** All timer control actions (start, pause, resume, skip, stop, tag) are on the `/timer` node. Session-level actions (tag, delete) are on individual session items. The root carries only identity.

2. **Affordances must be declared in descriptors (spec 05).** Each SDK must include the affordances in the descriptor returned by the dynamic registration function, not just register handlers separately. The descriptor is the source of truth.

3. **Use inline actions in dynamic descriptors.** The timer node's descriptor function must return different action lists based on current phase and pause state. This is the most critical alignment point — the state-dependent affordance table above is the contract.

4. **Salience values must be numeric.** All SDKs expect `meta.salience` as a float (0.0-1.0). Session salience must be computed identically based on time elapsed since completion.

5. **Timer updates must be debounced to 1-second intervals.** Even though the internal timer may tick faster for smooth UI animation, SLOP patches are sent at most once per second to avoid flooding consumers.

6. **Phase transition on timer completion.** When `time_remaining_sec` reaches 0, the provider must: (a) record the completed session if in working phase, (b) transition to the next phase, (c) refresh the tree. This must happen atomically from the consumer's perspective — a single patch, not multiple.

7. **Session IDs are sequential.** Format: `s-{N}` where N is monotonically increasing. All implementations must use this format.

8. **The `tag` action exists on both timer and session items.** On the timer node, it sets the current session's tag. On a session item, it re-tags a completed session. Same action name, different scope — this is correct per spec 05 (actions are unique within a node, not globally).

## Seed data

All implementations ship the same `seed.json` (copy it, don't regenerate):

```json
{
  "sessions": [
    {
      "id": "s-1",
      "tag": "Morning standup",
      "category": "meetings",
      "started_at": "2026-04-01T10:00:00Z",
      "ended_at": "2026-04-01T10:25:00Z",
      "duration_sec": 1500,
      "completed": true
    },
    {
      "id": "s-2",
      "tag": "Implement SLOP SDK",
      "category": "work",
      "started_at": "2026-04-01T12:30:00Z",
      "ended_at": "2026-04-01T12:55:00Z",
      "duration_sec": 1500,
      "completed": true
    },
    {
      "id": "s-3",
      "tag": "Write docs",
      "category": "docs",
      "started_at": "2026-04-01T14:15:00Z",
      "ended_at": "2026-04-01T14:40:00Z",
      "duration_sec": 1500,
      "completed": true
    },
    {
      "id": "s-4",
      "tag": "Code review",
      "category": "work",
      "started_at": "2026-04-01T15:45:00Z",
      "ended_at": "2026-04-01T16:10:00Z",
      "duration_sec": 1500,
      "completed": true
    }
  ],
  "settings": {
    "work_duration_sec": 1500,
    "short_break_sec": 300,
    "long_break_sec": 900,
    "long_break_interval": 4
  }
}
```
