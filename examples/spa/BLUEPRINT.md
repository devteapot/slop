# SPA Blueprint: `kanban-board` — Personal Kanban Board

A client-only kanban board with multiple boards, draggable columns, and prioritized cards. All data lives in localStorage — no server required. The app demonstrates how SPAs expose rich, structured state to AI consumers through SLOP, using postMessage and WebSocket transports.

This is the canonical SPA example. Five framework implementations (React, Vue, Angular, Solid, Svelte) all produce the identical SLOP tree from the same seed data, proving that SLOP is framework-agnostic.

## What this demonstrates

| SLOP feature | How it's used | Spec |
|---|---|---|
| State tree basics | Boards, columns, cards as a hierarchical tree | 02 |
| postMessage transport | Browser → AI consumer (via extension) | 03 |
| WebSocket transport | Browser → CLI/desktop (outbound WS) | 03 |
| Discovery | `<meta name="slop">` tag auto-injected | 03 |
| Affordances + params | CRUD on cards, move between columns, board navigation | 05 |
| Salience & urgency | Cards scored by priority + due date proximity | 06 |
| Windowed collections | Columns show 8 cards max, total in metadata | 09 |
| View-scoped trees | Active board expanded, inactive boards are stubs | 09 |
| Content references | Card descriptions as lazy-loadable markdown | 13 |

## App behavior

A kanban board with multiple boards. Each board has columns (Backlog, In Progress, Review, Done). Cards have titles, priorities, due dates, tags, and markdown descriptions. Users can create, edit, move, and delete cards.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [Product Launch]  [Personal]                    [Search] [+ New Card]  │
├─────────────────┬─────────────────┬────────────────┬────────────────────┤
│  BACKLOG (10)   │  IN PROGRESS (6)│  REVIEW (4)    │  DONE (4)         │
│                 │                 │                │                    │
│ ● Design        │ ● Implement     │ ● Landing page │ ● Project          │
│   onboarding    │   auth API      │   redesign     │   scaffolding     │
│   HIGH · Apr 5  │   CRIT · Apr 2  │   HIGH · Apr 1 │   ✓               │
│                 │                 │                │                    │
│ ● Write API     │ ● Build dash-   │ ● Payment      │ ● Design system   │
│   docs          │   board widgets │   integration  │   tokens          │
│   MED · Apr 10  │   HIGH · Apr 4  │   CRIT · Apr 2 │   ✓               │
│                 │                 │                │                    │
│ ● Set up error  │ ● Set up CI/CD  │ ● Mobile       │ ● Database        │
│   tracking      │   HIGH · Apr 3  │   responsive   │   schema design   │
│   MED · Apr 8   │                 │   MED · Apr 4  │   ✓               │
│                 │ ● Implement     │                │                    │
│ ● Create email  │   search index  │ ● Unit tests   │ ● User research   │
│   templates     │   MED · Apr 7   │   for models   │   interviews      │
│   LOW · Apr 15  │                 │   MED · Apr 5  │   ✓               │
│                 │ ● Create comp-  │                │                    │
│   +6 more       │   onent library │                │                    │
│                 │   MED · Apr 9   │                │                    │
│                 │                 │                │                    │
│                 │ ● Database      │                │                    │
│                 │   migrations    │                │                    │
│                 │   HIGH · Apr 3  │                │                    │
└─────────────────┴─────────────────┴────────────────┴────────────────────┘
```

### Single SLOP provider

The AI consumer sees **one provider** for this app:

- **Browser provider** (postMessage + WebSocket) — boards, columns, cards, all CRUD actions

Everything runs client-side. The SLOP tree exposes the full board state including card priorities, due dates, and descriptions. The AI can read the board, move cards, create new cards, and navigate between boards.

## Data model

### Client state (localStorage)

```typescript
interface Board {
  id: string;
  name: string;
  columns: string[];  // column IDs in display order
}

interface Card {
  id: string;
  board_id: string;
  column: string;     // column ID this card belongs to
  title: string;
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  due: string | null;  // ISO date string
  description: string; // markdown
  position: number;    // sort order within column
  created: string;     // ISO timestamp
}
```

Data is stored in `localStorage` under key `"kanban-data"`. On first load, if no data exists, `seed.json` is imported and persisted.

## SLOP tree

```
[root] kanban-board
  properties: { board_count: 2, active_board: "board-1" }
  affordances: [
    create_board(name: string),
    navigate(board_id: string) {idempotent: true},
  ]
  |
  ├── [view] board-1                                    ← ACTIVE
  │   properties: { name: "Product Launch", card_count: 24, column_count: 4 }
  │   meta: { focus: true }
  │   affordances: [
  │     create_card(title: string, column?: string, priority?: string, due?: string,
  │                 description?: string, tags?: string[]),
  │     rename(name: string) {idempotent: true},
  │     delete() {dangerous: true},
  │     search(query: string),
  │   ]
  │   |
  │   ├── [collection] backlog
  │   │   properties: { name: "Backlog", position: 0, card_count: 10 }
  │   │   meta: { window: [0, 8], total_children: 10 }
  │   │   affordances: [
  │   │     reorder(card_id: string, position: number),
  │   │   ]
  │   │   |
  │   │   ├── [item] card-1
  │   │   │   properties: { title: "Design onboarding flow", priority: "high",
  │   │   │                  tags: ["design", "ux"], due: "2026-04-05", column: "backlog" }
  │   │   │   meta: { salience: 0.8, urgency: "medium",
  │   │   │           reason: "high priority, due in 4 days" }
  │   │   │   content_ref: { type: "text", mime: "text/markdown", size: 285,
  │   │   │                  summary: "Design a 3-step wizard for new users",
  │   │   │                  preview: "## Onboarding Flow\n\nDesign a 3-step wizard..." }
  │   │   │   affordances: [
  │   │   │     edit(title?: string, priority?: string, due?: string, tags?: string[])
  │   │   │       {idempotent: true},
  │   │   │     move(column: string),
  │   │   │     delete() {dangerous: true},
  │   │   │     set_description(content: string),
  │   │   │   ]
  │   │   │
  │   │   ├── [item] card-2 ...
  │   │   └── ... (8 of 10 shown — windowed)
  │   │
  │   ├── [collection] in-progress
  │   │   properties: { name: "In Progress", position: 1, card_count: 6 }
  │   │   meta: { window: [0, 6], total_children: 6 }
  │   │   affordances: [reorder(card_id, position)]
  │   │   |
  │   │   ├── [item] card-11
  │   │   │   properties: { title: "Implement auth API", priority: "critical",
  │   │   │                  tags: ["backend", "security"], due: "2026-04-02",
  │   │   │                  column: "in-progress" }
  │   │   │   meta: { salience: 1.0, urgency: "critical",
  │   │   │           reason: "critical priority, due tomorrow", pinned: true }
  │   │   │   content_ref: { ... }
  │   │   │   affordances: [edit(...), move(column), delete(), set_description(content)]
  │   │   └── ...
  │   │
  │   ├── [collection] review
  │   │   properties: { name: "Review", position: 2, card_count: 4 }
  │   │   meta: { window: [0, 4], total_children: 4 }
  │   │   affordances: [reorder(card_id, position)]
  │   │   └── ...
  │   │
  │   └── [collection] done
  │       properties: { name: "Done", position: 3, card_count: 4 }
  │       meta: { window: [0, 4], total_children: 4 }
  │       affordances: [reorder(card_id, position)]
  │       |
  │       └── [item] card-21
  │           properties: { title: "Project scaffolding", priority: "high",
  │                          tags: ["infra"], due: "2026-03-22", column: "done" }
  │           meta: { salience: 0.2, urgency: "none",
  │                   reason: "completed" }
  │           affordances: [edit(...), move(column), delete(), set_description(content)]
  │
  └── [view] board-2                                    ← STUB (not active)
      properties: { name: "Personal" }
      meta: { summary: "3 columns, 8 cards — grocery shopping due today, dentist overdue" }
```

### View-scoping behavior

When `navigate(board_id)` is invoked:

1. The currently active board collapses to a stub (children removed, `meta.summary` added, `meta.focus` removed)
2. The target board expands (children added with full columns and cards, `meta.focus: true` set)
3. Root `properties.active_board` updates

This keeps the tree manageable — only one board's cards are in the tree at a time.

## Affordance schemas

### Root-level

| Action | Params | Metadata |
|---|---|---|
| `create_board` | `{ name: string }` | — |
| `navigate` | `{ board_id: string }` | `idempotent: true` |

### Board-level (view)

| Action | Params | Metadata |
|---|---|---|
| `create_card` | `{ title: string, column?: string, priority?: "low"\|"medium"\|"high"\|"critical", due?: string, description?: string, tags?: string[] }` | — |
| `rename` | `{ name: string }` | `idempotent: true` |
| `delete` | — | `dangerous: true` |
| `search` | `{ query: string }` | Returns filtered card list as result data |

### Column-level (collection)

| Action | Params | Metadata |
|---|---|---|
| `reorder` | `{ card_id: string, position: number }` | — |

### Card-level (item)

| Action | Params | Metadata |
|---|---|---|
| `edit` | `{ title?: string, priority?: "low"\|"medium"\|"high"\|"critical", due?: string, tags?: string[] }` | `idempotent: true` |
| `move` | `{ column: string }` | — |
| `delete` | — | `dangerous: true` |
| `set_description` | `{ content: string }` | — |

## Interactions

### 1. Read-only: AI answers "What's the most urgent task?"

1. AI reads the tree, scans all card items across columns
2. Finds `card-11` ("Implement auth API") with `salience: 1.0`, `urgency: "critical"`, due tomorrow
3. Responds: "The most urgent task is 'Implement auth API' — it's critical priority and due tomorrow. It's currently in the In Progress column."

No invocation needed — the answer is in the tree properties and meta.

### 2. Mutation: AI moves a card to done

1. User says: "Mark the landing page redesign as done"
2. AI finds `card-17` in the `review` column
3. AI invokes `move` on `board-1/review/card-17` with `{ column: "done" }`
4. Provider moves the card, recalculates salience (now 0.2), persists to localStorage
5. Consumer receives patches: `card-17` removed from `review` children, added to `done` children
6. AI confirms: "Moved 'Landing page redesign' to Done"

### 3. Mutation: AI creates a new card

1. User says: "Add a task to write unit tests for the auth API, high priority, due April 8"
2. AI invokes `create_card` on `board-1` with `{ title: "Write unit tests for auth API", column: "backlog", priority: "high", due: "2026-04-08", tags: ["testing", "backend"] }`
3. Provider creates the card, assigns next ID, persists to localStorage
4. Consumer receives patch adding the new card to `backlog` collection
5. AI confirms: "Created 'Write unit tests for auth API' in Backlog (high priority, due April 8)"

### 4. View navigation: AI switches boards

1. User says: "Show me my personal board"
2. AI invokes `navigate` on root with `{ board_id: "board-2" }`
3. Provider collapses `board-1` to stub, expands `board-2` with full columns and cards
4. Consumer receives patches: `board-1` children removed, `board-2` children added
5. AI now sees the Personal board: "Your Personal board has 8 cards. The most urgent is 'Book dentist appointment' (high priority, overdue since yesterday)."

### 5. Content reference: AI reads a card description

1. AI sees `card-11` ("Implement auth API") has `content_ref` with summary "Auth API Endpoints"
2. The preview shows the first lines: "## Auth API Endpoints\n\n### POST /auth/register..."
3. AI can answer questions about the auth implementation plan from the preview
4. If more detail is needed, the full markdown description is available via content ref

### 6. Search: AI finds cards matching a query

1. User says: "What design tasks do we have?"
2. AI invokes `search` on `board-1` with `{ query: "design" }`
3. Provider returns matching cards as result data (searching title, tags, description)
4. AI reports: "Found 4 design-related tasks: 'Design onboarding flow' (backlog, high), 'Design settings page' (backlog, medium), 'Landing page redesign' (review, high), 'Design system tokens' (done)"

## Salience rules

| Condition | Salience | Urgency | Pinned |
|---|---|---|---|
| Critical priority + due ≤ 2 days | 1.0 | `"critical"` | `true` |
| Critical priority | 0.9 | `"high"` | `true` |
| High priority + due ≤ 3 days | 0.8 | `"medium"` | — |
| High priority | 0.7 | `"low"` | — |
| Medium priority + due ≤ 3 days | 0.6 | `"medium"` | — |
| Medium priority | 0.5 | `"none"` | — |
| Low priority | 0.3 | `"none"` | — |
| In "Done" column (any priority) | 0.1–0.2 | `"none"` | — |
| Overdue (any priority) | +0.1 boost | upgrade one level | — |

Cards with `priority: "critical"` always have `meta.pinned: true`.

The `reason` field describes why the salience score was assigned, e.g. `"critical priority, due tomorrow"` or `"completed"`.

## Implementation constraints

| Aspect | React | Vue | Angular | Solid | Svelte |
|---|---|---|---|---|---|
| SLOP SDK | `@slop-ai/client` + `@slop-ai/react` | `@slop-ai/client` + `@slop-ai/vue` | `@slop-ai/client` + `@slop-ai/angular` | `@slop-ai/client` + `@slop-ai/solid` | `@slop-ai/client` (no adapter) |
| Build tool | Vite | Vite | Angular CLI | Vite | Vite |
| Dev port | 5173 | 5174 | 4200 | 5175 | 5176 |
| Transport | postMessage + WebSocket | postMessage + WebSocket | postMessage + WebSocket | postMessage + WebSocket | postMessage + WebSocket |
| Data storage | localStorage | localStorage | localStorage | localStorage | localStorage |
| External deps | react, react-dom | vue | @angular/* | solid-js | svelte |

### File structure (all frameworks)

```
examples/spa/<framework>/
├── package.json
├── index.html              (angular: src/index.html)
├── vite.config.ts          (angular: angular.json)
├── tsconfig.json
├── README.md
└── src/
    ├── main.tsx|ts          # App bootstrap
    ├── App.tsx|vue|svelte   # Root component
    ├── slop.ts              # createSlop instance
    ├── store.ts             # localStorage CRUD, seed loading
    ├── types.ts             # Board, Card types (shared across frameworks)
    ├── salience.ts          # Salience/urgency computation (shared)
    ├── styles.css           # Design system styles (shared)
    └── components/
        ├── BoardSwitcher    # Board tabs + create board
        ├── Column           # Column with windowed card list
        ├── Card             # Card display + quick actions
        ├── CardDetail       # Modal for full card view + description
        ├── CreateCard       # New card form
        └── SearchBar        # Board-level search
```

### Shared files

These files are **identical** across all five frameworks (pure TypeScript, no framework deps):

- `types.ts` — `Board` and `Card` interfaces
- `salience.ts` — `computeSalience(card)` and `computeUrgency(card)` functions
- `styles.css` — Full design system implementation

### SLOP setup (`slop.ts`)

```typescript
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "kanban-board",
  name: "Kanban Board",
  websocketUrl: true, // enables ws://localhost:9339/slop for CLI
});
```

## Seed data

See `seed.json` in this directory. Key characteristics:

- **2 boards**: "Product Launch" (24 cards, 4 columns) and "Personal" (8 cards, 3 columns)
- **Priority distribution**: 3 critical, 7 high, 10 medium, 5 low, 7 varied in done
- **Due dates**: Some overdue (exercises urgency), some upcoming (exercises salience), some null
- **Descriptions**: ~half have markdown descriptions (exercises content refs), ~half empty
- **Tags**: Diverse set for search/filter demos
- **Backlog has 10 cards**: Exceeds 8-card window, exercises windowing

## Cross-SDK alignment notes

- **Affordance placement.** `create_card` and `search` live on the board (view) node. `move`, `edit`, `delete`, `set_description` live on card items. `reorder` lives on column collections. `create_board` and `navigate` live on root. Never put card actions on the column or board.

- **Descriptor pattern varies by framework.** React `useSlop()` takes a plain object descriptor (re-evaluated on each render). Vue, Angular, Solid, and Svelte take an arrow function `() => NodeDescriptor` for reactive tracking. All five produce the same tree.

- **Dynamic paths.** All adapters accept `path: string | (() => string)`. Use a getter for paths that change at runtime (e.g., the active board ID). The adapter handles unregistering the old path automatically. React handles this via `useRef` since the hook re-runs on every render.

- **Content ref is top-level.** `contentRef` on `ItemDescriptor` maps to `content_ref` on the wire — it's a sibling of `properties`, not nested inside it. Only include `contentRef` when the card has a non-empty description.

- **View-scoped tree.** When `navigate(board_id)` is invoked, the implementation must: (a) collapse the current board to a stub with `meta.summary` and no children, (b) expand the target board with full columns and cards, (c) set `meta.focus: true` on the new board and remove it from the old. All frameworks must implement this identically.

- **Windowed collections.** Use `window: WindowDescriptor` (not `items`) on column descriptors when the column has more than 8 cards. The `WindowDescriptor` shape is `{ items: ItemDescriptor[], total: number, offset: number }`. For columns with ≤ 8 cards, use `items: ItemDescriptor[]` directly.

- **State-dependent affordances.** The `move` action's `column` param should list available target columns (all columns except the card's current column). This is informational via the param description, not enforced via enum (the handler should validate).

- **Salience computation is shared.** All frameworks import the same `salience.ts` module. Do not reimplement salience logic per framework.
