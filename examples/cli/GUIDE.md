# Guide: Exploring the `tsk` CLI

This guide walks you through using `tsk` in both normal mode and SLOP mode, so you can see exactly what changes when an AI is observing your app.

## Setup

Pick any implementation and build it:

```bash
# Bun
cd examples/cli/bun && bun install && bun link

# Python
cd examples/cli/python && pip install -e .

# Go
cd examples/cli/go && go install .

# Rust
cd examples/cli/rust && cargo install --path .
```

Seed the data file with sample tasks:

```bash
mkdir -p ~/.tsk
cp seed.json ~/.tsk/tasks.json
```

## Part 1: Normal mode

This is what a human sees. `tsk` is just a task manager.

### List your tasks

```bash
tsk
```

You see a formatted list — titles, due dates, tags, checkboxes. Overdue tasks are highlighted. Completed tasks are dimmed or marked. This is designed for human eyes.

### Add a task

```bash
tsk add "Deploy the new API" --due tomorrow --tag work
```

The tool confirms the task was created and shows it in the list.

### Complete a task

```bash
tsk done t-1
```

The task moves from pending to completed.

### Read notes

```bash
tsk notes t-1
```

Shows the full notes attached to a task. Notes can be multi-line — shopping lists, meeting notes, context for the task.

### Search

```bash
tsk search "work"
```

Filters tasks by title and tag. Shows matching results.

### Export

```bash
tsk export markdown
```

Dumps all tasks to stdout in the requested format.

---

Everything above is a normal CLI tool. Nothing special. Now let's see what an AI sees.

## Part 2: SLOP mode

Run the same tool with `--slop`:

```bash
tsk --slop
```

The tool starts a Unix socket and enters interactive mode:

```
tsk: listening on /tmp/slop/tsk.sock
tsk: 10 tasks loaded (7 pending, 1 overdue)
tsk>
```

This is the multi-modal experience. The tool is now a **provider** — it's listening on a Unix domain socket for AI consumers, while you can still type commands at the `tsk>` prompt. The SLOP protocol flows over the socket, keeping stdout free for human-readable output.

### Subscribe to the state tree

In another terminal, connect to the socket and send a subscribe message. Here's an example using `socat`:

```bash
echo '{"type":"subscribe","id":"s1","path":"/","depth":-1}' | socat - UNIX-CONNECT:/tmp/slop/tsk.sock
```

Or programmatically — any SLOP consumer can connect to the Unix socket. The provider sends a **hello** message on connection, then responds to subscribe with a **snapshot**: the entire state tree as structured JSON.

```json
{
  "type": "snapshot",
  "id": "s1",
  "version": 1,
  "tree": {
    "id": "tsk",
    "type": "root",
    "children": [
      {
        "id": "tasks",
        "type": "collection",
        "properties": { "count": 10, "pending": 7, "overdue": 1 },
        "meta": {
          "summary": "10 tasks: 7 pending, 3 done, 1 overdue",
          "total_children": 10,
          "window": [0, 10]
        },
        "affordances": [
          { "action": "add", "params": { ... } },
          { "action": "clear_done", "dangerous": true }
        ],
        "children": [
          {
            "id": "t-4",
            "type": "item",
            "properties": {
              "title": "Call dentist for checkup",
              "done": false,
              "due": "2026-03-28",
              "tags": ["health"]
            },
            "meta": { "salience": 1.0, "urgency": "high", "reason": "2 days overdue" },
            "affordances": [
              { "action": "done" },
              { "action": "edit", "params": { ... } },
              { "action": "delete", "dangerous": true }
            ]
          }
        ]
      }
    ]
  }
}
```

### What the AI sees vs what you see

This is the key difference. Compare:

**You see:**
```
4. [ ] Call dentist for checkup    due: overdue!   #health
```

One line. You parse the `[ ]`, the `overdue!`, the `#health` visually. You know what to do because you're human.

**The AI sees:**
```json
{
  "id": "t-4",
  "properties": { "title": "Call dentist for checkup", "done": false, "due": "2026-03-28", "tags": ["health"] },
  "meta": { "salience": 1.0, "urgency": "high", "reason": "2 days overdue" },
  "affordances": [
    { "action": "done", "label": "Complete task" },
    { "action": "edit", "params": { "properties": { "title": {}, "due": {}, "tags": {} } } },
    { "action": "delete", "dangerous": true }
  ]
}
```

The AI knows:
- This task is **urgent** (salience 1.0, urgency "high") — it should probably mention this first
- It's **2 days overdue** — the reason is in plain text, not inferred from date math
- It can **complete** it, **edit** it, or **delete** it — and delete requires confirmation
- The edit action accepts title, due, and tags — the AI knows the schema

The AI doesn't scrape text. It doesn't guess what commands exist. It reads structured state and acts through declared affordances.

### Invoke an action

With the SLOP session running, an AI consumer sends an invoke message over the Unix socket:

```json
{"type":"invoke","id":"inv-1","path":"/tasks","action":"add","params":{"title":"Test from AI","due":"tomorrow","tags":"test"}}
```

The provider responds:

```json
{"type":"result","id":"inv-1","status":"ok","data":{"id":"t-11"}}
```

And immediately sends a **patch** to all subscribers — the new task appears in the tree:

```json
{"type":"patch","subscription":"s1","version":2,"ops":[
  {"op":"add","path":"/children/tasks/children/t-11","value":{"id":"t-11","type":"item","properties":{"title":"Test from AI","done":false,"due":"2026-03-31","tags":["test"]},"meta":{"salience":0.7},"affordances":[...]}}
]}
```

Meanwhile, at the `tsk>` prompt, you can run `list` and see the AI's task right there. The AI and the human see the same state.

### Content references: lazy-loading notes

Notice that task notes aren't in the tree. The AI sees:

```json
{
  "content_ref": {
    "type": "text",
    "mime": "text/plain",
    "summary": "2 lines of notes about groceries",
    "preview": "Milk, eggs, bread, avocados..."
  }
}
```

The summary tells the AI what's in the notes without loading them. If the AI needs the full text, it invokes `read_notes`:

```json
{"type":"invoke","id":"inv-2","path":"/tasks/t-1","action":"read_notes","params":{}}
```

Response:

```json
{"type":"result","id":"inv-2","status":"ok","data":{"content":"Milk, eggs, bread, avocados\nCheck if we need coffee"}}
```

This is the SLOP equivalent of glancing at a file tab vs opening the file. The AI chooses when to pay the token cost.

### Salience: what matters right now

The tree isn't a flat list. Tasks are sorted by salience:

| Task | Salience | Why |
|---|---|---|
| Call dentist (overdue) | 1.0 | 2 days past due |
| Buy groceries (today) | 0.9 | Due today |
| Review PR (today) | 0.9 | Due today |
| Write blog post (tomorrow) | 0.7 | Due tomorrow |
| Plan weekend trip (no due) | 0.4 | No deadline |
| Fix login bug (done) | 0.2 | Completed |

If an AI subscribes with a salience filter (`min_salience: 0.5`), it only sees the urgent tasks. Completed tasks and low-priority items disappear — the AI's context window focuses on what matters.

### Discovery

While running in SLOP mode, check the discovery directory:

```bash
cat ~/.slop/providers/tsk.json
```

```json
{
  "id": "tsk",
  "name": "tsk",
  "version": "0.1.0",
  "slop_version": "0.1",
  "transport": { "type": "unix", "path": "/tmp/slop/tsk.sock" },
  "pid": 48291,
  "capabilities": ["state", "patches", "affordances", "attention"],
  "description": "Task manager with 10 tasks (7 pending, 1 overdue)"
}
```

Any AI agent scanning `~/.slop/providers/` can find `tsk`, connect to its Unix socket, and start observing. When `tsk --slop` exits, this file is cleaned up.

## Part 3: Multi-modal — human + AI, side by side

This is the key value proposition. Run SLOP mode and interact with it as a human while an AI observes via the socket:

**Terminal 1** — SLOP mode (human + AI interface):
```bash
tsk --slop
```

You see:
```
tsk: listening on /tmp/slop/tsk.sock
tsk: 10 tasks loaded (7 pending, 1 overdue)
tsk>
```

Now type commands directly at the prompt:
```
tsk> add "New task from human" --due tomorrow
Created task #11
tsk> done t-4
Completed: Call dentist for checkup
tsk> list
  ...
```

Every mutation you make sends patches over the socket to any connected AI consumer. The AI sees your changes in real time.

Meanwhile, the AI can invoke actions through the socket — adding tasks, completing them, searching. When the AI acts, you see the results the next time you run `list`.

**Terminal 2** — connect as an AI consumer:
```bash
socat - UNIX-CONNECT:/tmp/slop/tsk.sock
```

You'll receive the hello message, and can send subscribe/invoke messages. Patches from your Terminal 1 commands stream through.

**This is the point.** There is no "AI version" of your app. There's one process, one data file, one set of tasks. The human uses stdin/stdout. The AI uses the Unix socket. Both interfaces operate on the same state. SLOP is just a structured window into what's already there.
