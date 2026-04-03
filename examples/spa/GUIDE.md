# Guide: Exploring the Kanban Board SPA

This guide walks through a personal kanban board built as a client-only SPA. Five implementations — React, Vue, Angular, Solid, and Svelte — all produce the same SLOP tree. Pick any framework; the SLOP experience is identical.

## Setup

### Pick a framework

Each implementation is a standalone project. Choose one:

```bash
# React
cd examples/spa/react && bun install && bun run dev
# → http://localhost:5173

# Vue
cd examples/spa/vue && bun install && bun run dev
# → http://localhost:5174

# Solid
cd examples/spa/solid && bun install && bun run dev
# → http://localhost:5175

# Svelte
cd examples/spa/svelte && bun install && bun run dev
# → http://localhost:5176

# Angular
cd examples/spa/angular && bun install && bun run dev
# → http://localhost:4200
```

The app loads seed data into localStorage on first run. To reset: open the browser console and run `localStorage.removeItem("kanban-data")`, then refresh.

### Build the CLI

```bash
cd apps/cli
go build -o slop-inspect .
```

---

## Part 1: Normal mode

Open the app in your browser. You'll see a kanban board with two boards: **Product Launch** and **Personal**.

### The Product Launch board

Four columns: Backlog (10 cards), In Progress (6), Review (4), Done (4). Each card shows:

- **Priority badge** — CRIT (red), HIGH (orange), MED (blue), LOW (gray)
- **Title** — the task name
- **Due date** — when it's due (red if overdue)
- **Tags** — colored labels
- **Description icon** — ☰ if the card has a description

Cards with critical priority have a green glow. Overdue cards have a red left border.

### Try it

1. Click a card to open the detail modal — edit title, priority, due date, tags, and description
2. Click the ⋮ menu on a card to move it to another column or delete it
3. Click **+ New Card** to create a card
4. Click **Personal** tab to switch boards
5. Use the search bar to filter cards

Everything persists in localStorage. Refresh the page — your changes are still there.

---

## Part 2: SLOP mode

Now let's see what an AI consumer sees. The app exposes its state as a SLOP tree over WebSocket.

### Connect the CLI

In a separate terminal:

```bash
cd apps/cli
./slop-inspect --connect ws://localhost:9339/slop
```

You should see the hello message and then the full tree:

```
Connected to kanban-board (Kanban Board)
Capabilities: state, patches, affordances, attention

kanban-board [root]
  board_count: 2
  active_board: "board-1"
  actions: create_board(name), navigate(board_id)

  board-1 [view] ← focus
    name: "Product Launch"
    card_count: 24
    column_count: 4
    actions: create_card(title, column?, priority?, ...), rename(name), delete(), search(query)

    backlog [collection]
      name: "Backlog"
      card_count: 10
      window: [0, 8] of 10

      card-1 [item]  salience: 0.8  urgency: medium
        title: "Design onboarding flow"
        priority: "high"
        tags: ["design", "ux"]
        due: "2026-04-05"
        content: "Design a 3-step wizard for new users" (285 bytes)
        actions: edit(...), move(column), delete(), set_description(content)

      card-11 [item]  salience: 1.0  urgency: critical  ★ pinned
        title: "Implement auth API"
        priority: "critical"
        due: "2026-04-02"
        ...

    in-progress [collection] ...
    review [collection] ...
    done [collection] ...

  board-2 [view]  (stub)
    name: "Personal"
    summary: "3 columns, 8 cards, 2 due this week"
```

### What the AI sees

The tree is a structured representation of the entire board. Notice:

- **Salience scores** — the AI knows `card-11` (auth API, critical, due tomorrow) is the most urgent item at salience 1.0
- **Windowed collections** — Backlog shows 8 of 10 cards, avoiding token waste
- **Content references** — card descriptions show a summary, not the full markdown
- **View scoping** — only the active board is expanded; Personal is a one-line stub

### Invoke an action

Move a card to done:

```
> invoke board-1/review/card-17 move {"column": "done"}
```

Watch the browser — the card moves from Review to Done in real time. The CLI shows the patch:

```
Patch: remove /board-1/review/card-17
Patch: add /board-1/done/card-17
```

Create a new card:

```
> invoke board-1 create_card {"title": "Write tests for auth", "column": "backlog", "priority": "high", "due": "2026-04-08", "tags": "testing,backend"}
```

The new card appears in the Backlog column in the browser.

### Navigate between boards

```
> invoke / navigate {"board_id": "board-2"}
```

The tree restructures — `board-1` collapses to a stub and `board-2` expands with its full columns and cards. In the browser, the Personal board tab activates.

### Search

```
> invoke board-2 search {"query": "dentist"}
```

Returns matching cards as structured data — the AI can answer "what's overdue on my personal board?" without reading every card.

---

## Part 3: Side by side

The most powerful demo: run the app and the CLI side by side.

1. Open the browser with the kanban board
2. Connect the CLI in a terminal next to it

**What the human sees:**
```
┌─────────────┬─────────────┐
│  BACKLOG    │ IN PROGRESS │
│             │             │
│ ● Auth API  │             │
│   CRIT ·Apr2│             │
└─────────────┴─────────────┘
```

**What the AI sees (simultaneously):**
```json
{
  "id": "card-11",
  "type": "item",
  "properties": {
    "title": "Implement auth API",
    "priority": "critical",
    "due": "2026-04-02"
  },
  "meta": {
    "salience": 1.0,
    "urgency": "critical",
    "reason": "critical priority, due tomorrow",
    "pinned": true
  },
  "content_ref": {
    "type": "text",
    "mime": "text/markdown",
    "summary": "Auth API Endpoints",
    "size": 456
  },
  "affordances": [
    { "action": "edit", "params": {...}, "idempotent": true },
    { "action": "move", "params": { "column": "string" } },
    { "action": "delete", "dangerous": true }
  ]
}
```

Now make a change in the browser — drag a card, edit a title, create a new card. The CLI immediately shows the corresponding patch.

Make a change from the CLI — invoke `move` or `create_card`. The browser immediately updates.

**Same app. Same state. Two interfaces.** The human sees a kanban board. The AI sees a structured state tree with affordances. SLOP doesn't create a separate "AI version" — it exposes what's already there.

---

## Framework comparison

All five implementations produce the exact same SLOP tree. The difference is in how the adapter integrates:

| Framework | Adapter | Registration pattern |
|---|---|---|
| React | `@slop-ai/react` | `useSlop(slop, path, descriptor)` — plain object |
| Vue | `@slop-ai/vue` | `useSlop(slop, path, () => descriptor)` — function |
| Angular | `@slop-ai/angular` | `useSlop(slop, path, () => descriptor)` — in constructor |
| Solid | `@slop-ai/solid` | `useSlop(slop, path, () => descriptor)` — function |
| Svelte | `@slop-ai/svelte` | `useSlop(slop, path, () => descriptor)` — rune-based |

All adapters accept dynamic paths via `() => string` getters (e.g., `useSlop(slop, () => activeBoard?.id ?? "__none__", ...)`), handling path changes and cleanup automatically.
