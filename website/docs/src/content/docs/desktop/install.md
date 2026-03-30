---
title: Desktop App
description: Install and use the SLOP desktop app
---

The SLOP desktop app provides a unified interface for connecting to all SLOP providers — local apps, web apps, and SPAs through the browser extension bridge.

## Install

### From releases

Coming soon.

### Build from source

Requires [Rust](https://rustup.rs/) and [Bun](https://bun.sh/):

```bash
git clone https://github.com/devteapot/slop.git
cd slop/desktop
bun install
bunx tauri dev
```

## Features

- **Workspaces** — organize providers into workspace tabs, each with its own chat and connections
- **Unified multi-provider chat** — AI sees all connected providers at once, can act across apps
- **Smart sidebar** — providers grouped by Pinned, Local Apps, Browser Tabs (collapsible)
- **Pin providers** — pin per workspace, auto-reconnect on workspace activation
- **Workspace-scoped connections** — switching workspaces switches active provider sets
- **Provider discovery** — automatically finds local SLOP providers via `~/.slop/providers/`
- **Manual connections** — add WebSocket or Unix socket URLs manually
- **Browser bridge** — sees browser providers announced by the Chrome extension
- **LLM chat** — chat with AI about any connected provider's state
- **State tree viewer** — inspect the live SLOP tree

## Browser bridge

The desktop app runs a WebSocket bridge server at `ws://localhost:9339`. When the Chrome extension's "Desktop bridge" toggle is enabled, browser providers appear in the desktop sidebar.

- **Server-backed web apps** (WebSocket) — desktop connects directly, no relay needed
- **SPAs** (postMessage) — messages relay through the extension bridge

## Provider sources

| Source | Transport | How discovered |
|---|---|---|
| Local apps | Unix socket | `~/.slop/providers/*.json` |
| Web apps | WebSocket | Extension bridge announcement |
| SPAs | postMessage (relayed) | Extension bridge announcement |
| Manual | WebSocket or Unix socket | User enters URL |

## Roadmap: SLOP-enabled desktop app

The desktop app is currently a SLOP **consumer** — it connects to providers and lets you interact with their state. A planned feature is making the desktop app itself a SLOP **provider**, exposing its own state via Unix socket at `~/.slop/providers/slop-desktop.json`.

This would allow CLI agents, Claude Code, or any SLOP consumer to programmatically control the desktop app:

```
root (slop-desktop)
├── providers                    ← connected providers
│   ├── kanban-board             ← { status: "connected", transport: "ws" }
│   │   actions: disconnect, show_tree
│   └── (collection)              actions: connect(url: string)
├── conversations                ← chat history per provider
│   └── kanban-board             actions: send_message(text: string), clear
└── settings
    └── active_profile           ← { name: "Google", model: "gemini-2.5-flash" }
        actions: switch_profile, switch_model
```

Use cases:
- **AI workspace orchestration** — an agent discovers the desktop app and uses it to connect to multiple providers, run queries, and aggregate results
- **CLI integration** — `slop invoke slop-desktop/providers connect --url ws://localhost:3000/slop` from the terminal
- **SLOP all the way down** — the tool that consumes SLOP also speaks SLOP
