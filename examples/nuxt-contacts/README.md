# Nuxt Contacts

A fullstack contacts app built with Nuxt 3 that exposes server state via the SLOP protocol over WebSocket.

The server manages all contact state and broadcasts changes to connected SLOP clients using Nitro's native WebSocket support.

## Run

```bash
bun install
bun run dev
```

Open http://localhost:3000 for the UI.

## SLOP endpoint

Connect via WebSocket at `ws://localhost:3000/slop`.

The endpoint implements SLOP 0.1 with capabilities: `state`, `patches`, `affordances`.

### Supported messages

- `subscribe` - receive a full state snapshot
- `invoke` - execute an affordance (add_contact, toggle_favorite, edit, delete)
- `unsubscribe` - stop receiving updates

State changes from any source (REST API or SLOP invoke) are broadcast to all subscribers.
