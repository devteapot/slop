# Guide: Exploring the Contact Manager

A full-stack contact manager with a Python backend and a React frontend. Two separate SLOP providers — one per language — that any AI consumer can subscribe to simultaneously.

## Setup

### Backend (Python)

```bash
cd examples/full-stack/python-react/backend
uv sync        # or: pip install -e .
uv run contacts-api
```

The server starts at `http://localhost:8000`. SLOP WebSocket endpoint at `ws://localhost:8000/slop`.

### Frontend (React)

```bash
cd examples/full-stack/python-react/frontend
bun install
bun run dev
```

Opens at `http://localhost:5173`. The Vite dev server proxies `/api` and `/slop` to the Python backend.

## Part 1: The web app

Open `http://localhost:5173` in your browser. You see a contact manager with 10 seed contacts:

- **Left panel:** Searchable, filterable contact list. Starred contacts (Alice, Dave, Grace) sort to the top.
- **Right panel:** Contact detail with tags, notes, and activity log.
- **Tag bar:** Filter by tag (work, family, vip, etc.).
- **Compose form:** Click "+ New Contact" to add someone.

Try it out: search for "Acme", filter by "vip", click Alice to see her notes and activity. This is a normal web app. Nothing unusual.

## Part 2: What the AI sees

Two SLOP providers are running:

### Server provider (Python — data)

Connect a SLOP consumer to `ws://localhost:8000/slop`. Subscribe to see the full data tree:

```
[root] contacts-api
  [collection] contacts (count=10, starred=3)
    [item] contact-7  Grace Kim — Startup Co CEO          salience=1.0  pinned
    [item] contact-1  Alice Chen — Acme Corp Engineer     salience=0.9  pinned
    [item] contact-4  Dave Wilson — Acme Corp CTO         salience=0.9  pinned
    [item] contact-9  Iris Nakamura — BigTech DevRel      salience=0.7
    [item] contact-2  Bob Martinez — Acme Corp PM         salience=0.6
    [item] contact-6  Frank Lee — Acme Corp EM            salience=0.5
    [item] contact-3  Carol Davis — Design Studio         salience=0.45
    [item] contact-10 James Wright — Attorney             salience=0.2
    [item] contact-5  Eva Thompson                        salience=0.2
    [item] contact-8  Henry Park                          salience=0.2
  [collection] tags (count=8)
    [item] tag-work (12 contacts)
    [item] tag-vip (3 contacts)
    ...
```

Notice:
- **Salience ordering.** Grace Kim (starred + activity today) is at the top. Eva and Henry (no recent activity) are at the bottom.
- **Pinned nodes.** All three starred contacts have `meta.pinned: true`.
- **Content references.** Alice has a `content_ref` with a preview of her notes — the AI can read the summary without loading the full text.
- **Activity sub-collections.** Each contact has an `activity` child collection showing recent interactions.

The AI can invoke actions directly:

```jsonc
// Create a contact
{ "type": "invoke", "id": "i1", "path": "/contacts", "action": "create",
  "params": { "name": "Sarah Park", "company": "Studio Five" } }

// Star someone
{ "type": "invoke", "id": "i2", "path": "/contacts/contact-3", "action": "star" }

// Search
{ "type": "invoke", "id": "i3", "path": "/contacts", "action": "search",
  "params": { "query": "Acme" } }
```

### Browser provider (React — UI state)

The SLOP browser extension discovers the in-page provider via `<meta name="slop" content="postmessage">`. It exposes:

```
[root] contacts-ui
  [status] search     query="" result_count=10     {set_query, clear}
  [status] filter     active_tag=null              {set_tag, clear}
  [status] selection  contact_id=null              {select, deselect}
  [view]   compose    open=false name="" email=""   {open, close, fill, submit}
```

This is what the user is looking at right now. The AI can:

```jsonc
// Search for someone
{ "type": "invoke", "path": "/search", "action": "set_query",
  "params": { "query": "Acme" } }

// Filter by tag
{ "type": "invoke", "path": "/filter", "action": "set_tag",
  "params": { "tag": "vip" } }

// Select a contact
{ "type": "invoke", "path": "/selection", "action": "select",
  "params": { "contact_id": "contact-1" } }

// Open the compose form and fill it
{ "type": "invoke", "path": "/compose", "action": "fill",
  "params": { "name": "New Person", "email": "new@example.com" } }
```

## Part 3: Two providers, one picture

The AI consumer sees both providers in its workspace:

```
Workspace: "Contacts"
  contacts-api    ws    ← Python server: data + actions
  contacts-ui     pm    ← React browser: UI state + navigation
```

When a user asks "Find Alice's email and add a note about our meeting":

1. AI reads `contacts-api` → finds `contact-1` → `alice@example.com`
2. AI invokes `add_note` on `contacts-api:/contacts/contact-1` with the meeting note
3. AI invokes `select` on `contacts-ui:/selection` to navigate the UI to Alice
4. The browser shows Alice's detail view, now with the new note

The Python server handled the data mutation. The React app handled the UI navigation. The AI coordinated both through standard SLOP — no shared runtime, no language coupling.

## The takeaway

This is a normal full-stack app. Python API, React SPA, REST in between. Adding SLOP was:

- **Backend:** ~80 lines in `slop_tree.py` to register the data tree. One `SlopMiddleware` line in `main.py`.
- **Frontend:** ~5 lines per component (`useSlop` calls). One `createSlop` initialization.

Two providers, two languages, two transports — but the AI sees one coherent picture of the app. That's SLOP.
