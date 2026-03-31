# CLI Blueprint: `tsk` — A Task Manager

A task manager CLI that works normally for humans, and becomes a SLOP provider when invoked with `--slop`. Demonstrates the core value proposition: **any CLI tool can become AI-observable with a single flag**.

## What this demonstrates

| SLOP feature | How it's used |
|---|---|
| **`--slop` flag pattern** (spec 07) | Normal CLI output vs SLOP provider mode |
| **Unix socket transport** (spec 03) | NDJSON over Unix domain socket |
| **Multi-modal** | Simultaneous AI (socket) + human (stdin/stdout) interaction |
| **State tree** (spec 02) | Task list as a collection with item children |
| **Affordances** (spec 05) | CRUD actions on tasks, bulk operations on collection |
| **Attention & salience** (spec 06) | Overdue tasks = high salience, completed = low |
| **Content references** (spec 13) | Task notes as lazy-loaded content |
| **Scaling: windowed collections** (spec 09) | Only show first N tasks, expose total count |
| **Discovery** (spec 03) | Write provider descriptor to `~/.slop/providers/` |
| **Async actions** (spec 14) | Export action that takes time |

## App behavior

### Normal mode (human-readable)

```
$ tsk
  1. [ ] Buy groceries         due: today      #errands
  2. [ ] Write blog post       due: tomorrow   #writing
  3. [x] Fix login bug         done: 2h ago    #work
  4. [ ] Call dentist           due: overdue!   #health

$ tsk add "Review PR" --due tomorrow --tag work
Created task #5

$ tsk done 1
Completed: Buy groceries

$ tsk list --tag work
  3. [x] Fix login bug         done: 2h ago    #work
  5. [ ] Review PR             due: tomorrow   #work
```

### SLOP mode (AI-observable + human-interactive)

```
$ tsk --slop
tsk: listening on /tmp/slop/tsk.sock
tsk: 10 tasks loaded (7 pending, 2 overdue)
tsk> add "Deploy v2.0" --due tomorrow --tag work
Created task #11
tsk> done 4
Completed: Call dentist
tsk> list
  1. [ ] Buy groceries         due: today      #errands
  ...
```

AI consumers connect to the Unix socket and receive the SLOP state tree via NDJSON. Meanwhile, the human uses stdin/stdout to interact with the same task list — mutations from either side are visible to both. This is the multi-modal value prop: **one process, two interfaces**.

## Data model

Tasks are stored in a local JSON file (`~/.tsk/tasks.json`):

```json
{
  "tasks": [
    {
      "id": "t-1",
      "title": "Buy groceries",
      "done": false,
      "due": "2026-03-30",
      "tags": ["errands"],
      "notes": "Milk, eggs, bread, avocados\nCheck if we need coffee",
      "created": "2026-03-29T10:00:00Z"
    }
  ]
}
```

Default path: `~/.tsk/tasks.json`. Override with `TSK_FILE` env var or `--file` flag.

## SLOP tree

This is the exact tree structure the provider must expose. Node IDs, types, properties, and affordances are the **contract** — all implementations must produce this same tree.

```
[root] tsk
  properties: { version: "0.1.0" }
  │
  ├── [context] user
  │   properties: { file: "~/.tsk/tasks.json", total_tasks: 47, total_done: 32 }
  │
  ├── [collection] tasks
  │   properties: { count: 47, pending: 15, overdue: 2 }
  │   meta: {
  │     summary: "47 tasks: 15 pending, 32 done, 2 overdue",
  │     total_children: 47,
  │     window: [0, 25]
  │   }
  │   affordances: [
  │     add(title: string, due?: string, tags?: string),
  │     clear_done(),
  │     export(format: string),       ← async action
  │     search(query: string)         ← search lives here, not on root
  │   ]
  │   │
  │   ├── [item] t-4                  ← overdue tasks first (highest salience)
  │   │   properties: { title: "Call dentist", done: false, due: "2026-03-28", tags: ["health"] }
  │   │   meta: { salience: 1.0, urgency: "high", reason: "2 days overdue" }
  │   │   affordances: [done(), edit(title?, due?, tags?), delete()]
  │   │   contentRef: {
  │   │     type: "text", mime: "text/plain",
  │   │     summary: "No notes",
  │   │   }
  │   │
  │   ├── [item] t-1                  ← due today
  │   │   properties: { title: "Buy groceries", done: false, due: "2026-03-30", tags: ["errands"] }
  │   │   meta: { salience: 0.9, urgency: "medium", reason: "due today" }
  │   │   affordances: [done(), edit(title?, due?, tags?), delete()]
  │   │   contentRef: {
  │   │     type: "text", mime: "text/plain", size: 47,
  │   │     summary: "2 lines of notes about groceries",
  │   │     preview: "Milk, eggs, bread, avocados..."
  │   │   }
  │   │
  │   ├── [item] t-2                  ← due tomorrow
  │   │   properties: { title: "Write blog post", done: false, due: "2026-03-31", tags: ["writing"] }
  │   │   meta: { salience: 0.7, urgency: "low" }
  │   │   affordances: [done(), edit(title?, due?, tags?), delete()]
  │   │
  │   ├── ... (25 of 47 shown)
  │   │
  │   └── [item] t-3                  ← completed tasks last (lowest salience)
  │       properties: { title: "Fix login bug", done: true, tags: ["work"], completed_at: "2026-03-30T14:00:00Z" }
  │       meta: { salience: 0.2 }
  │       affordances: [undo(), delete()]
  │
  └── [collection] tags
      properties: { count: 4 }
      meta: { summary: "4 tags: errands (3), work (12), writing (5), health (2)" }
      affordances: [rename(old: string, new: string)]
```

### Sort order

Tasks appear in the tree sorted by salience (highest first):
1. Overdue tasks (salience 1.0, urgency high)
2. Due today (salience 0.9, urgency medium)
3. Due this week (salience 0.7, urgency low)
4. Due later (salience 0.5)
5. No due date (salience 0.4)
6. Completed (salience 0.2)

### Windowing

The `tasks` collection uses windowed children (spec 09):
- Default window: first 25 tasks (sorted by salience)
- `meta.total_children`: total task count
- `meta.window`: `[offset, count]`
- Consumer can query different windows

### Content references

Task notes use content references (spec 13):
- `contentRef.type`: "text"
- `contentRef.summary`: brief description of notes content
- `contentRef.preview`: first ~100 chars (if notes exist)
- Fetched via `read_notes` action on the task item
- Tasks with no notes: `summary: "No notes"`, no preview

## Affordance schemas

### Collection level (tasks)

```json
[
  {
    "action": "add",
    "label": "Add task",
    "params": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "due": { "type": "string", "description": "ISO date or relative: 'today', 'tomorrow', 'next monday'" },
        "tags": { "type": "string", "description": "Comma-separated tags" }
      },
      "required": ["title"]
    },
    "estimate": "instant"
  },
  {
    "action": "clear_done",
    "label": "Clear completed",
    "description": "Remove all completed tasks",
    "dangerous": true,
    "estimate": "instant"
  },
  {
    "action": "export",
    "label": "Export tasks",
    "description": "Export tasks to a file",
    "params": {
      "type": "object",
      "properties": {
        "format": { "type": "string", "enum": ["json", "csv", "markdown"] }
      },
      "required": ["format"]
    },
    "estimate": "slow"
  },
  {
    "action": "search",
    "label": "Search tasks",
    "description": "Search tasks by title or tag",
    "params": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Search term (matches title and tags)" }
      },
      "required": ["query"]
    },
    "idempotent": true,
    "estimate": "instant"
  }
]
```

### Item level (pending task)

```json
[
  {
    "action": "done",
    "label": "Complete task",
    "estimate": "instant"
  },
  {
    "action": "edit",
    "label": "Edit task",
    "params": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "due": { "type": "string" },
        "tags": { "type": "string" }
      }
    },
    "estimate": "instant"
  },
  {
    "action": "delete",
    "label": "Delete task",
    "dangerous": true,
    "estimate": "instant"
  },
  {
    "action": "read_notes",
    "label": "Read full notes",
    "description": "Fetch the complete notes for this task",
    "idempotent": true,
    "estimate": "instant"
  },
  {
    "action": "write_notes",
    "label": "Write notes",
    "params": {
      "type": "object",
      "properties": {
        "content": { "type": "string" }
      },
      "required": ["content"]
    },
    "estimate": "instant"
  }
]
```

### Item level (completed task)

Completed tasks swap `done` for `undo`:

```json
[
  {
    "action": "undo",
    "label": "Mark incomplete",
    "estimate": "instant"
  },
  {
    "action": "delete",
    "label": "Delete task",
    "dangerous": true,
    "estimate": "instant"
  }
]
```

## Interactions

These are the scenarios the example should support. Use them as acceptance tests.

### 1. AI reads the task list

```
Consumer subscribes → receives snapshot
AI sees: "47 tasks: 15 pending, 32 done, 2 overdue"
AI sees overdue task "Call dentist" with salience 1.0
AI can answer: "You have 2 overdue tasks" without loading all 47 items
```

### 2. AI adds a task

```
AI invokes: add({ title: "Deploy v2.0", due: "2026-04-01", tags: "work" })
Provider: creates task, writes to disk, rebuilds tree
Consumer receives: patch adding new child to tasks collection
AI sees: new task in tree with assigned ID
```

### 3. AI completes a task

```
AI invokes: done() on task t-1
Provider: marks done, updates completed_at, writes to disk
Consumer receives: patch updating t-1 properties (done=true, salience drops to 0.2)
AI sees: task moved to completed section, affordances change to [undo, delete]
```

### 4. AI reads task notes (content reference)

```
AI sees contentRef on t-1: summary="2 lines of notes about groceries", preview="Milk, eggs..."
AI decides it needs full notes
AI invokes: read_notes() on t-1
Provider returns: { content: "Milk, eggs, bread, avocados\nCheck if we need coffee" }
```

### 5. AI searches

```
AI invokes: search({ query: "work" }) on /tasks
Provider returns: filtered task list matching "work" (by title or tag)
```

### 6. AI exports (async action)

```
AI invokes: export({ format: "markdown" })
Provider returns: { status: "accepted", task_id: "export-1" }
Provider sends patch: export-1 node appears with status "running"
... time passes ...
Provider sends patch: export-1 status → "complete", result includes file path
```

### 7. Human and AI interact simultaneously (multi-modal)

```
Human types: add "Buy birthday present" --due 2026-04-05 --tag personal
Provider: creates task, writes to disk, calls refresh()
AI consumer receives: patch adding new child to tasks collection
AI sees: new task appears in tree without needing to invoke anything

AI invokes: done() on task t-4
Provider: marks done, writes to disk, calls refresh()
Human sees: (next time they run "list") task is completed
```

## CLI interface (normal mode)

All implementations must support these commands:

```
tsk                          # list all pending tasks
tsk list                     # same as above
tsk list --all               # include completed
tsk list --tag <tag>         # filter by tag
tsk add <title> [--due <date>] [--tag <tag>]
tsk done <id>                # mark complete
tsk undo <id>                # mark incomplete
tsk edit <id> [--title <t>] [--due <d>] [--tag <t>]
tsk delete <id>              # remove task
tsk notes <id>               # show notes
tsk notes <id> --set <text>  # set notes
tsk search <query>           # search by title/tag
tsk export <format>          # export to stdout
tsk --slop                   # enter SLOP provider mode (socket + interactive CLI)
tsk --slop --sock <path>     # use alternate socket path
tsk --file <path>            # use alternate data file
```

Default socket path: `/tmp/slop/tsk.sock`. Override with `--sock` flag or `TSK_SOCK` env var.

The binary/script name is `tsk` in all languages.

## SLOP mode behavior

When invoked with `--slop`:

1. **Start socket listener** — bind a Unix domain socket at the configured path
2. **Print status to stdout** — announce the socket path and task summary so a human can see what's happening
3. **Enter interactive CLI loop** — read CLI commands from stdin (same commands as normal mode: `list`, `add`, `done`, etc.) and print results to stdout. After each mutation, call `refresh()` so AI consumers receive patches.
4. **Handle AI consumers on socket** — accept SLOP connections on the Unix socket, respond to subscribe/query/invoke messages via NDJSON
5. **Watch for changes** — if the data file changes on disk (external edit), rebuild tree and send patches
6. **Discovery** — write a provider descriptor to `~/.slop/providers/tsk.json` on start, remove on exit:
   ```json
   {
     "id": "tsk",
     "name": "tsk",
     "version": "0.1.0",
     "slop_version": "0.1",
     "transport": { "type": "unix", "path": "/tmp/slop/tsk.sock" },
     "pid": 12345,
     "capabilities": ["state", "patches", "affordances", "attention"],
     "description": "Task manager with 47 tasks (15 pending, 2 overdue)"
   }
   ```

## Cross-SDK alignment notes

These rules ensure all implementations produce identical SLOP trees. They follow the protocol spec — see the referenced sections for details.

1. **Affordances go on the node they operate on (spec 05).** Don't register on the root path. Place search on the tasks collection, not on root. The root carries identity, not actions.

2. **Affordances must be declared in descriptors (spec 05).** Handlers registered separately don't automatically appear in the tree. Include actions in the descriptor dict/JSON returned by dynamic registrations.

3. **Use inline actions in dynamic descriptors.** When using `register_fn` / `@slop.node` / dynamic registration, include actions directly in the returned descriptor. This is the most portable pattern.

4. **Salience values must be numeric.** All SDKs expect `meta.salience` as a float (0.0–1.0).

5. **Item actions must match done/pending state.** Pending tasks expose `done`, `edit`, `delete`, `read_notes`, `write_notes`. Completed tasks expose `undo`, `delete`. Never both `done` and `undo` on the same item.

6. **`content_ref` is a top-level field (spec 13).** It is a sibling of `properties` on the wire node, not nested inside `properties`. Use the descriptor's `contentRef` / `content_ref` field and the SDK normalizes it correctly.

7. **The test harness (`test-harness.ts`) is the source of truth.** Run `bun run test-harness.ts all` after any change. All implementations must pass all tests.

## Implementation constraints

- **Use the language's SLOP SDK** — `@slop-ai/server` for Bun, `slop` for Python, `slop` for Go, `slop_ai` for Rust
- **No external dependencies beyond the SDK** and the language's stdlib/standard ecosystem
- **Data file**: JSON, at `~/.tsk/tasks.json` by default
- **Transport**: Unix domain socket (NDJSON over Unix socket)
- **Binary name**: `tsk`
- **Seed data**: ship with a `seed.json` containing 10 sample tasks (mix of pending, done, overdue, with and without notes)

## File structure per implementation

```
examples/cli/<language>/
├── README.md           # How to build and run
├── seed.json           # 10 sample tasks
└── src/                # Source code (language-appropriate structure)
```

## Seed data

All implementations ship the same `seed.json` (copy it, don't regenerate):

```json
{
  "tasks": [
    {
      "id": "t-1",
      "title": "Buy groceries",
      "done": false,
      "due": "2026-03-30",
      "tags": ["errands"],
      "notes": "Milk, eggs, bread, avocados\nCheck if we need coffee",
      "created": "2026-03-28T10:00:00Z"
    },
    {
      "id": "t-2",
      "title": "Write blog post about SLOP",
      "done": false,
      "due": "2026-03-31",
      "tags": ["writing", "work"],
      "notes": "Cover the --slop flag pattern and why it matters for AI integration",
      "created": "2026-03-27T09:00:00Z"
    },
    {
      "id": "t-3",
      "title": "Fix login page redirect bug",
      "done": true,
      "tags": ["work", "bugs"],
      "notes": "",
      "created": "2026-03-25T14:00:00Z",
      "completed_at": "2026-03-30T14:30:00Z"
    },
    {
      "id": "t-4",
      "title": "Call dentist for checkup",
      "done": false,
      "due": "2026-03-28",
      "tags": ["health"],
      "notes": "",
      "created": "2026-03-20T08:00:00Z"
    },
    {
      "id": "t-5",
      "title": "Review Alice's PR #142",
      "done": false,
      "due": "2026-03-30",
      "tags": ["work"],
      "notes": "Focus on the auth middleware changes\nCheck test coverage",
      "created": "2026-03-29T16:00:00Z"
    },
    {
      "id": "t-6",
      "title": "Plan weekend trip",
      "done": false,
      "tags": ["personal"],
      "notes": "Look into cabin rentals near Lake Tahoe",
      "created": "2026-03-26T12:00:00Z"
    },
    {
      "id": "t-7",
      "title": "Update project dependencies",
      "done": true,
      "tags": ["work"],
      "notes": "",
      "created": "2026-03-24T10:00:00Z",
      "completed_at": "2026-03-29T11:00:00Z"
    },
    {
      "id": "t-8",
      "title": "Read 'Designing Data-Intensive Applications' ch. 5",
      "done": false,
      "due": "2026-04-05",
      "tags": ["learning"],
      "notes": "Replication chapter — compare with our current setup",
      "created": "2026-03-22T09:00:00Z"
    },
    {
      "id": "t-9",
      "title": "Prepare slides for team standup",
      "done": false,
      "due": "2026-04-01",
      "tags": ["work"],
      "notes": "",
      "created": "2026-03-29T08:00:00Z"
    },
    {
      "id": "t-10",
      "title": "Cancel unused Heroku dynos",
      "done": true,
      "tags": ["work", "infra"],
      "notes": "Staging and old demo environments",
      "created": "2026-03-23T15:00:00Z",
      "completed_at": "2026-03-28T16:00:00Z"
    }
  ]
}
```
