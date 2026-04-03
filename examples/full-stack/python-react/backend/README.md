# Contacts API — Python FastAPI Backend

SLOP-enabled contact manager backend. Exposes contacts, tags, and activity via REST + SLOP WebSocket.

## Setup

```bash
cd backend
uv sync          # or: pip install -e .
```

## Run

```bash
contacts-api     # starts on http://localhost:8000
```

Or directly:

```bash
uv run uvicorn contacts_api.main:app --reload --port 8000
```

## Endpoints

- `GET  /api/contacts` — list contacts (optional `?q=` search, `?tag=` filter)
- `GET  /api/contacts/:id` — contact detail with activity
- `POST /api/contacts` — create contact
- `PUT  /api/contacts/:id` — edit contact
- `DELETE /api/contacts/:id` — delete contact
- `POST /api/contacts/:id/star` — star
- `DELETE /api/contacts/:id/star` — unstar
- `POST /api/contacts/:id/tags` — add tag
- `DELETE /api/contacts/:id/tags/:tag` — remove tag
- `POST /api/contacts/:id/notes` — add note
- `POST /api/contacts/:id/activity` — log activity
- `GET  /api/tags` — list tags
- `PUT  /api/tags/:name` — rename tag

## SLOP

- WebSocket: `ws://localhost:8000/slop`
- Discovery: `GET /.well-known/slop`
