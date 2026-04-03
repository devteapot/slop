# Full-Stack Blueprint: `python-react` — Contact Manager

A contact manager with a Python FastAPI backend and a React SPA frontend. The backend owns the data (contacts, tags, activity log) and exposes it via SLOP over WebSocket. The frontend exposes UI state (search query, active filters, selected contact, compose form) via SLOP over postMessage. AI consumers connect to both providers and see the full picture: data + what the user is looking at.

This is the canonical cross-SDK integration example. It proves that a Python server and a JavaScript browser client produce trees that any SLOP consumer can subscribe to independently — no shared runtime, no language coupling.

## What this demonstrates

| SLOP feature | How it's used | Spec |
|---|---|---|
| State tree basics | Contacts collection, tags, activity log | 02 |
| WebSocket transport | Python backend → AI consumer | 03 |
| postMessage transport | React frontend → AI consumer (via extension) | 03 |
| Discovery | `/.well-known/slop` (server) + `<meta>` tag (browser) | 03 |
| Affordances + params | CRUD on contacts, tag management, search | 05 |
| Salience & attention | Recently active contacts scored higher, starred contacts pinned | 06 |
| Windowed collections | Contact list paged (20 per window) | 09 |
| Content references | Contact notes as lazy-loadable text | 13 |

## App behavior

### The web app

A single-page contact manager. The left panel shows a searchable, filterable contact list. Clicking a contact opens a detail view on the right with full info, notes, and activity history.

```
┌─────────────────────────────────────────────────────────┐
│  Contacts          [Search: ________]  [+ New Contact]  │
│                    [Tags: work, family, vip]             │
├──────────────────┬──────────────────────────────────────┤
│ ★ Alice Chen     │  Alice Chen                          │
│   Senior Engineer│  alice@example.com · +1 555-0101     │
│                  │  Tags: work, vip                     │
│   Bob Martinez   │                                      │
│   Product Manager│  Notes:                              │
│                  │  Key stakeholder for the Q2 launch.  │
│   Carol Davis    │  Prefers async communication.        │
│   Designer       │                                      │
│                  │  Activity:                           │
│   ...            │  · Email sent (2 days ago)           │
│                  │  · Meeting scheduled (1 week ago)    │
│ 47 contacts      │  · Note added (2 weeks ago)          │
└──────────────────┴──────────────────────────────────────┘
```

### Two SLOP providers

The AI consumer (extension chat or desktop app) sees **two providers** for this app:

1. **Server provider** (`ws://localhost:8000/slop`) — contacts, tags, activity log, CRUD actions
2. **Browser provider** (postMessage) — search query, active tag filter, selected contact ID, compose form state

The consumer merges them. When the AI wants to "find Alice's email," it reads the server tree. When it wants to "clear the search filter," it invokes an action on the browser tree.

## Data model

### Backend (Python, in-memory with seed data)

```python
contacts: list[Contact]  # id, name, email, phone, company, title, tags, notes, starred, created_at, updated_at
tags: list[str]           # unique tag names derived from contacts
activity: list[Activity]  # id, contact_id, type, description, timestamp
```

No database — seed data loaded from `seed.json` on startup. Mutations persist in memory only.

### Frontend (React state)

```typescript
search: string            // current search query
activeTag: string | null  // tag filter (null = all)
selectedId: string | null // currently viewed contact
composeForm: {            // new contact form state
  open: boolean
  name: string
  email: string
  company: string
}
```

## SLOP tree — server provider

```
[root] contacts-api
  properties: { contact_count: 47, tag_count: 8 }
  |
  ├── [collection] contacts
  │   properties: { count: 47, starred: 3 }
  │   meta: { window: [0, 20], total_children: 47 }
  │   affordances: [
  │     create(name: string, email?: string, phone?: string, company?: string, title?: string, tags?: string[]),
  │     search(query: string) → snapshot,
  │   ]
  │   |
  │   ├── [item] contact-1
  │   │   properties: { name: "Alice Chen", email: "alice@example.com", phone: "+1 555-0101",
  │   │                  company: "Acme Corp", title: "Senior Engineer", tags: ["work", "vip"],
  │   │                  starred: true }
  │   │   meta: { salience: 0.9, reason: "starred + recent activity", pinned: true }
  │   │   content_ref: { type: "text", mime: "text/plain", summary: "Key stakeholder for Q2 launch...",
  │   │                  size: 847, preview: "Key stakeholder for the Q2 launch. Prefers async..." }
  │   │   affordances: [
  │   │     edit(name?: string, email?: string, phone?: string, company?: string, title?: string),
  │   │     delete() {dangerous: true},
  │   │     star(),
  │   │     unstar(),
  │   │     add_tag(tag: string),
  │   │     remove_tag(tag: string),
  │   │     add_note(content: string),
  │   │     log_activity(type: string, description: string),
  │   │   ]
  │   │   |
  │   │   └── [collection] activity
  │   │       properties: { count: 3 }
  │   │       |
  │   │       ├── [item] act-1
  │   │       │   properties: { type: "email", description: "Email sent", timestamp: "2026-03-29T10:00:00Z" }
  │   │       ├── [item] act-2
  │   │       │   properties: { type: "meeting", description: "Meeting scheduled", timestamp: "2026-03-24T14:00:00Z" }
  │   │       └── [item] act-3
  │   │           properties: { type: "note", description: "Note added", timestamp: "2026-03-17T09:00:00Z" }
  │   │
  │   ├── [item] contact-2
  │   │   properties: { name: "Bob Martinez", ... }
  │   │   meta: { salience: 0.6 }
  │   │   ...
  │   └── ... (windowed — 20 items shown, 47 total)
  │
  └── [collection] tags
      properties: { count: 8 }
      |
      ├── [item] tag-work
      │   properties: { name: "work", contact_count: 12 }
      │   affordances: [rename(new_name: string)]
      ├── [item] tag-family
      │   properties: { name: "family", contact_count: 8 }
      │   affordances: [rename(new_name: string)]
      └── ...
```

## SLOP tree — browser provider

```
[root] contacts-ui
  |
  ├── [status] search
  │   properties: { query: "", result_count: 47 }
  │   affordances: [
  │     set_query(query: string),
  │     clear(),
  │   ]
  │
  ├── [status] filter
  │   properties: { active_tag: null, available_tags: ["work", "family", "vip", ...] }
  │   affordances: [
  │     set_tag(tag: string),
  │     clear(),
  │   ]
  │
  ├── [status] selection
  │   properties: { contact_id: "contact-1", contact_name: "Alice Chen" }
  │   affordances: [
  │     select(contact_id: string),
  │     deselect(),
  │   ]
  │
  └── [view] compose
      properties: { open: false, name: "", email: "", company: "" }
      affordances: [
        open(),
        close(),
        fill(name?: string, email?: string, company?: string),
        submit(),
      ]
```

## Affordance schemas

### Server — collection-level (`contacts`)

| Action | Params | Metadata |
|---|---|---|
| `create` | `{ name: string, email?: string, phone?: string, company?: string, title?: string, tags?: string[] }` | — |
| `search` | `{ query: string }` | Returns snapshot of matching contacts |

### Server — item-level (`contacts/{id}`)

| Action | Params | Metadata |
|---|---|---|
| `edit` | `{ name?: string, email?: string, phone?: string, company?: string, title?: string }` | `idempotent: true` |
| `delete` | — | `dangerous: true` |
| `star` | — | `idempotent: true` |
| `unstar` | — | `idempotent: true` |
| `add_tag` | `{ tag: string }` | — |
| `remove_tag` | `{ tag: string }` | — |
| `add_note` | `{ content: string }` | — |
| `log_activity` | `{ type: string, description: string }` | — |

### Server — tag-level (`tags/{tag}`)

| Action | Params | Metadata |
|---|---|---|
| `rename` | `{ new_name: string }` | — |

### Browser — UI actions

| Node | Action | Params |
|---|---|---|
| `search` | `set_query` | `{ query: string }` |
| `search` | `clear` | — |
| `filter` | `set_tag` | `{ tag: string }` |
| `filter` | `clear` | — |
| `selection` | `select` | `{ contact_id: string }` |
| `selection` | `deselect` | — |
| `compose` | `open` | — |
| `compose` | `close` | — |
| `compose` | `fill` | `{ name?: string, email?: string, company?: string }` |
| `compose` | `submit` | — |

## Interactions

### 1. Read-only: AI answers "What's Alice's email?"

1. AI reads server tree at `/contacts`
2. Finds `contact-1` with `properties.email: "alice@example.com"`
3. Responds to user: "Alice Chen's email is alice@example.com"

No invocation needed — the answer is in the tree.

### 2. Mutation: AI creates a new contact

1. User says: "Add John Smith from Google, john@google.com"
2. AI invokes `create` on `/contacts` with `{ name: "John Smith", email: "john@google.com", company: "Google" }`
3. Server adds contact, calls `refresh()`
4. Consumer receives patch adding `contact-48` to the collection
5. AI confirms: "Added John Smith (john@google.com) at Google"

### 3. Cross-provider: AI searches for a contact

1. User says: "Search for anyone at Acme"
2. AI invokes `set_query` on the browser's `/search` node with `{ query: "Acme" }`
3. Browser filters the displayed list, updates `result_count`
4. AI reads the server's `/contacts` and invokes `search` with `{ query: "Acme" }` for the full result set
5. AI reports: "Found 3 contacts at Acme Corp: Alice Chen, Dave Wilson, and Frank Lee"

### 4. Content reference: AI reads contact notes

1. AI sees `contact-1` has `content_ref` with summary "Key stakeholder for Q2 launch..."
2. The preview is sufficient to answer most questions without loading the full text
3. If more detail is needed, the full notes can be loaded via the content ref URI

### 5. UI interaction: AI fills and submits the compose form

1. User says: "Add a contact for Sarah Park, she's a designer at Studio Five"
2. AI invokes `open` on browser's `/compose`
3. AI invokes `fill` with `{ name: "Sarah Park", company: "Studio Five" }`
4. AI invokes `submit` on browser's `/compose`
5. The browser form's `submit` handler calls the API, which creates the contact
6. Server refreshes, consumer sees the new contact in the tree

## Implementation constraints

| Aspect | Value |
|---|---|
| Backend SDK | `slop-ai` (Python) |
| Frontend SDK | `@slop-ai/client` + `@slop-ai/react` |
| Backend framework | FastAPI |
| Frontend framework | React (Vite) |
| Transport (server) | WebSocket at `/slop` |
| Transport (browser) | postMessage |
| Data storage | In-memory (loaded from `seed.json`) |
| Backend port | 8000 |
| Frontend port | 5173 (Vite default) |
| External deps | `fastapi`, `uvicorn` (Python); `react`, `vite` (JS) |

### File structure

```
examples/full-stack/python-react/
├── BLUEPRINT.md
├── GUIDE.md
├── seed.json
├── backend/
│   ├── pyproject.toml
│   ├── src/
│   │   └── contacts_api/
│   │       ├── __init__.py
│   │       ├── main.py          # FastAPI app + SLOP middleware
│   │       ├── state.py         # In-memory store + seed loading
│   │       └── slop_tree.py     # SLOP registrations
│   └── README.md
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── slop.ts              # createSlop instance
    │   ├── api.ts               # REST API calls to backend
    │   ├── components/
    │   │   ├── ContactList.tsx
    │   │   ├── ContactDetail.tsx
    │   │   ├── SearchBar.tsx
    │   │   ├── TagFilter.tsx
    │   │   └── ComposeForm.tsx
    │   └── types.ts
    └── README.md
```

## Seed data

```json
{
  "contacts": [
    {
      "id": "contact-1",
      "name": "Alice Chen",
      "email": "alice@example.com",
      "phone": "+1 555-0101",
      "company": "Acme Corp",
      "title": "Senior Engineer",
      "tags": ["work", "vip"],
      "starred": true,
      "notes": "Key stakeholder for the Q2 launch. Prefers async communication via email. Has deep expertise in distributed systems.\n\nMet at the 2025 infrastructure conference. Introduced us to their CTO.",
      "created_at": "2025-09-15T10:00:00Z",
      "updated_at": "2026-03-29T10:00:00Z"
    },
    {
      "id": "contact-2",
      "name": "Bob Martinez",
      "email": "bob@example.com",
      "phone": "+1 555-0102",
      "company": "Acme Corp",
      "title": "Product Manager",
      "tags": ["work"],
      "starred": false,
      "notes": "Runs the internal tools team. Good contact for partnership discussions.",
      "created_at": "2025-10-01T09:00:00Z",
      "updated_at": "2026-03-20T14:00:00Z"
    },
    {
      "id": "contact-3",
      "name": "Carol Davis",
      "email": "carol@designstudio.io",
      "phone": "+1 555-0103",
      "company": "Design Studio",
      "title": "Creative Director",
      "tags": ["work", "design"],
      "starred": false,
      "notes": "Freelance designer we've worked with on two projects. Fast turnaround, great with brand work.",
      "created_at": "2025-11-10T11:00:00Z",
      "updated_at": "2026-02-15T16:00:00Z"
    },
    {
      "id": "contact-4",
      "name": "Dave Wilson",
      "email": "dave@acme.com",
      "phone": "+1 555-0104",
      "company": "Acme Corp",
      "title": "CTO",
      "tags": ["work", "vip"],
      "starred": true,
      "notes": "Alice introduced us. Very interested in our protocol work. Schedule a follow-up demo in April.",
      "created_at": "2026-01-05T10:00:00Z",
      "updated_at": "2026-03-28T09:00:00Z"
    },
    {
      "id": "contact-5",
      "name": "Eva Thompson",
      "email": "eva@gmail.com",
      "phone": "+1 555-0105",
      "company": "",
      "title": "",
      "tags": ["family"],
      "starred": false,
      "notes": "",
      "created_at": "2025-08-20T08:00:00Z",
      "updated_at": "2025-08-20T08:00:00Z"
    },
    {
      "id": "contact-6",
      "name": "Frank Lee",
      "email": "frank@acme.com",
      "phone": "+1 555-0106",
      "company": "Acme Corp",
      "title": "Engineering Manager",
      "tags": ["work"],
      "starred": false,
      "notes": "Manages the platform team. Good escalation path for infrastructure issues.",
      "created_at": "2026-02-01T10:00:00Z",
      "updated_at": "2026-03-15T11:00:00Z"
    },
    {
      "id": "contact-7",
      "name": "Grace Kim",
      "email": "grace@startup.co",
      "phone": "+1 555-0107",
      "company": "Startup Co",
      "title": "CEO",
      "tags": ["work", "vip"],
      "starred": true,
      "notes": "Potential investor. Very bullish on developer tools. Meeting scheduled for next week.",
      "created_at": "2026-03-01T10:00:00Z",
      "updated_at": "2026-03-30T10:00:00Z"
    },
    {
      "id": "contact-8",
      "name": "Henry Park",
      "email": "henry@gmail.com",
      "phone": "+1 555-0108",
      "company": "",
      "title": "",
      "tags": ["family", "sports"],
      "starred": false,
      "notes": "Tennis partner. Plays Saturdays at 9am.",
      "created_at": "2025-07-01T08:00:00Z",
      "updated_at": "2025-12-10T08:00:00Z"
    },
    {
      "id": "contact-9",
      "name": "Iris Nakamura",
      "email": "iris@bigtech.com",
      "phone": "+1 555-0109",
      "company": "BigTech Inc",
      "title": "Developer Advocate",
      "tags": ["work", "community"],
      "starred": false,
      "notes": "Met at a conference. Interested in writing about our protocol. Send her the spec link when it's public.",
      "created_at": "2026-03-10T10:00:00Z",
      "updated_at": "2026-03-25T15:00:00Z"
    },
    {
      "id": "contact-10",
      "name": "James Wright",
      "email": "james@law.firm.com",
      "phone": "+1 555-0110",
      "company": "Wright & Associates",
      "title": "Attorney",
      "tags": ["legal"],
      "starred": false,
      "notes": "Handles our IP filings. Responsive via email, prefers formal communication.",
      "created_at": "2025-06-15T10:00:00Z",
      "updated_at": "2026-01-20T10:00:00Z"
    }
  ],
  "activity": [
    { "id": "act-1", "contact_id": "contact-1", "type": "email", "description": "Sent project update email", "timestamp": "2026-03-29T10:00:00Z" },
    { "id": "act-2", "contact_id": "contact-1", "type": "meeting", "description": "Quarterly review meeting", "timestamp": "2026-03-24T14:00:00Z" },
    { "id": "act-3", "contact_id": "contact-1", "type": "note", "description": "Added follow-up notes", "timestamp": "2026-03-17T09:00:00Z" },
    { "id": "act-4", "contact_id": "contact-4", "type": "email", "description": "Sent demo invitation", "timestamp": "2026-03-28T09:00:00Z" },
    { "id": "act-5", "contact_id": "contact-4", "type": "meeting", "description": "Intro call with CTO", "timestamp": "2026-03-15T10:00:00Z" },
    { "id": "act-6", "contact_id": "contact-7", "type": "email", "description": "Sent pitch deck", "timestamp": "2026-03-30T10:00:00Z" },
    { "id": "act-7", "contact_id": "contact-7", "type": "meeting", "description": "Coffee chat at conference", "timestamp": "2026-03-01T15:00:00Z" },
    { "id": "act-8", "contact_id": "contact-9", "type": "email", "description": "Shared early spec draft", "timestamp": "2026-03-25T15:00:00Z" },
    { "id": "act-9", "contact_id": "contact-3", "type": "meeting", "description": "Design review for landing page", "timestamp": "2026-02-15T16:00:00Z" },
    { "id": "act-10", "contact_id": "contact-2", "type": "email", "description": "Partnership proposal follow-up", "timestamp": "2026-03-20T14:00:00Z" }
  ]
}
```

### Salience rules

| Condition | Salience | Reason |
|---|---|---|
| Starred + activity in last 7 days | 0.9–1.0 | `"starred + recent activity"` |
| Starred, no recent activity | 0.7 | `"starred"` |
| Activity in last 7 days | 0.6–0.8 | `"recent activity"` |
| Activity in last 30 days | 0.4–0.5 | `"active this month"` |
| No recent activity | 0.2 | `"inactive"` |

Starred contacts have `meta.pinned: true`.

## Cross-SDK alignment notes

- **Two separate providers.** The Python server and the React browser client are independent SLOP providers. They do NOT share a transport or merge trees on the server. The consumer (extension/desktop) merges them. This is the standard multi-provider pattern, distinct from the TanStack Start single-provider-with-UI-mount pattern.
- **Affordance placement.** Search lives on the `contacts` collection (server-side data search). The UI `search` node exposes `set_query`/`clear` for the browser's filter state. These are complementary, not redundant.
- **Content ref is top-level.** `content_ref` is a sibling of `properties` on the wire, not nested inside `properties`.
- **REST API for cross-boundary mutations.** When the browser's compose form submits, it calls the backend's REST API, not the SLOP invoke. SLOP exposes state; the app's own API handles mutations that cross the client/server boundary. The server calls `refresh()` after the REST mutation.
