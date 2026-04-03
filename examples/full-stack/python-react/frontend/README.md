# Contacts UI (React Frontend)

React SPA for the SLOP contact manager example. Exposes UI state (search, filter, selection, compose form) via SLOP over postMessage.

## Setup

```bash
# From repo root
bun install

# From this directory
bun run dev
```

The dev server runs on http://localhost:5173 and proxies `/api` and `/slop` to the Python backend at `localhost:8000`.

## Prerequisites

Start the Python backend first:

```bash
cd ../backend
uvicorn contacts_api.main:app --reload
```
