# SLOP Protocol Overview

Quick reference for the SLOP protocol concepts relevant to consuming app state.

## Core Concepts

**State tree** — A hierarchical, semantic representation of what an app is right now. Each node has:
- `id` — stable identifier
- `type` — semantic role (root, view, collection, item, document, form, field, control, status, notification, context)
- `properties` — the actual data (key-value pairs)
- `children` — nested nodes
- `affordances` — actions available on this node
- `meta` — attention hints (salience, summary, focus, changed, urgency)
- `content_ref` — reference to large content not inlined in the tree

**Affordances** — Actions attached to specific nodes. Unlike global tool lists, affordances are contextual:
- They appear only when the action is valid
- Parameters are defined with JSON Schema
- The target node is implicit (no need to pass IDs)
- `dangerous: true` means confirm with user first
- `estimate: "async"` means the action returns immediately and reports progress via the state tree

**Subscriptions** — Consumers subscribe to parts of the tree at a given depth. The provider sends an initial snapshot, then incremental patches as state changes. Patches use node-ID-based paths (stable across reordering).

## Progressive Disclosure

The tree supports depth-controlled resolution:
- **Depth 0** — node only, no children
- **Depth 1** — node + direct children
- **Depth N** — N levels deep
- **Depth -1** — full tree (use with caution on large apps)

Nodes beyond the requested depth become **stubs**: just `id`, `type`, and `meta.summary`. Use `slop_query` to drill deeper.

## Windowed Collections

Large collections (hundreds+ items) show a window:
```
[collection] inbox (count=1420)  — "1420 messages, 12 unread"
  (showing 25 of 1420)
  [item] msg-1: "Launch plan" from alice (unread=true)
  ...
```

Use `slop_query` with `window_offset` and `window_count` to page through.

## Attention & Salience

Nodes carry attention hints in `meta`:
- **salience** (0–1) — importance right now. 1.0 = critical, 0.0 = background
- **focus** — user is currently interacting with this node
- **changed** — modified in the last update
- **urgency** — none, low, medium, high, critical
- **reason** — natural language explanation of why this is important

Focus on nodes with high salience first.

## Content References

Large content (documents, files, images) is not inlined. Instead:
```
content_ref: {
  type: "text" | "binary" | "stream",
  mime: "text/typescript",
  size: 12400,
  summary: "TypeScript module...",
  preview: "import { createSlop }..."
}
```

Use the `read_content` affordance to fetch full content when needed.

## Async Actions

Actions with `estimate: "async"` return `status: "accepted"` with a `taskId`. Progress appears as a status node in the tree:
```
[status] deploy-123 (progress=0.7, message="Running tests...")  actions: {cancel}
```

Task statuses: pending → running → done | failed | cancelled.

## Provider Discovery

Providers register descriptor files:
- `~/.slop/providers/` — user-level (persistent apps)
- `/tmp/slop/providers/` — session-level (ephemeral)

Each descriptor contains: id, name, transport (ws/unix/stdio), capabilities, and optionally a PID for liveness checking.

## Transport

The plugin supports three transports:
- **WebSocket** — `ws://host:port/slop` — for server-backed web apps and remote providers
- **Unix socket** — `/tmp/slop/app.sock` — for local native apps, low latency
- **Extension relay** — for browser-only SPAs using postMessage. Messages are wrapped in a `slop-relay` envelope and routed through the browser extension via a local WebSocket bridge at `ws://127.0.0.1:9339/slop-bridge`.

All three speak the same SLOP message protocol (subscribe, snapshot, patch, invoke, result). The relay transport is fully transparent — the same state trees and affordances appear regardless of how the provider is connected.

## Extension Bridge

The SLOP browser extension discovers web apps with `<meta name="slop">` tags and announces them over a local WebSocket bridge. The bridge protocol uses these message types:

- `provider-available` — extension announces a new SLOP provider (includes transport type and URL)
- `provider-unavailable` — provider is gone (tab closed, navigated away)
- `relay-open` / `relay-close` — consumer signals it wants to start/stop relaying messages for a postMessage provider
- `slop-relay` — wraps a SLOP message for relay delivery (bidirectional)

For WebSocket providers announced by the extension, the plugin connects directly to the app's WebSocket URL. For postMessage providers, it uses the relay channel.
