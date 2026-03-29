# SvelteKit Links

A link shortener / bookmarks app built with SvelteKit 2 and the SLOP protocol.

The server manages all state and exposes it via a WebSocket SLOP endpoint at `/slop`. The UI uses SvelteKit form actions for progressive enhancement, with real-time updates pushed through the SLOP WebSocket.

## Run

```bash
bun install
bun run dev
```

Open http://localhost:5173

## SLOP Endpoint

Connect a WebSocket to `ws://localhost:5173/slop` to observe and mutate state.

### Messages

**hello** (server -> client on connect):
```json
{ "type": "hello", "provider": { "id": "sveltekit-links", "name": "SvelteKit Links", "slop_version": "0.1", "capabilities": ["state", "patches", "affordances"] } }
```

**subscribe** (client -> server):
```json
{ "type": "subscribe", "id": "sub-1", "path": "/", "depth": -1 }
```

**invoke** (client -> server):
```json
{ "type": "invoke", "id": "inv-1", "path": "/", "action": "add_link", "params": { "title": "Example", "url": "https://example.com" } }
{ "type": "invoke", "id": "inv-2", "path": "/1", "action": "visit" }
{ "type": "invoke", "id": "inv-3", "path": "/1", "action": "delete" }
```

State snapshots are automatically broadcast to all subscribers whenever the state changes.
