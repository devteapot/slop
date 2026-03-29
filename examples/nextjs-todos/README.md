# Next.js Todos + SLOP

A fullstack todo app built with Next.js 15 that exposes its state via the SLOP (State Language Observation Protocol) WebSocket endpoint.

## Quick start

```bash
bun install
bun run dev
```

The app runs at http://localhost:3000.

## SLOP endpoint

- **WebSocket**: `ws://localhost:3000/api/slop`
- **Discovery**: `http://localhost:3000/.well-known/slop`
- **HTML meta tag**: `<meta name="slop" content="ws://localhost:3000/api/slop" />`

The WebSocket provides real-time state observation with affordances. AI agents can subscribe to the todo list state tree and invoke actions (add, toggle, delete) through the protocol.

## Architecture

- `server.ts` — Custom Node server running Next.js with a WebSocket server on the same port
- `lib/state.ts` — In-memory todo state with change notification
- `lib/slop-server.ts` — SLOP protocol handler: builds state trees, manages subscriptions, broadcasts updates
- `app/` — Next.js App Router UI (dark theme)
- `app/api/todos/` — REST API routes for the web UI
