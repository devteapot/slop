# Kanban Board — Vue

SPA kanban board built with Vue 3 and SLOP.

## Setup

```bash
bun install
bun run dev
```

The app runs at http://localhost:5174. SLOP is available via:

- **postMessage** — for browser extensions
- **WebSocket** — `ws://localhost:9339/slop` for CLI/desktop

## Connect with CLI

```bash
cd ../../../apps/cli
go run . --connect ws://localhost:9339/slop
```
