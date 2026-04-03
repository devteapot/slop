# Kanban Board — React

SPA kanban board built with React and SLOP.

## Setup

```bash
bun install
bun run dev
```

The app runs at http://localhost:5173. SLOP is available via:

- **postMessage** — for browser extensions
- **WebSocket** — `ws://localhost:9339/slop` for CLI/desktop

## Connect with CLI

```bash
cd ../../../apps/cli
go run . --connect ws://localhost:9339/slop
```
