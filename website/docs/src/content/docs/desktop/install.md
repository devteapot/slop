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

- **Provider discovery** — automatically finds local SLOP providers via `~/.slop/providers/`
- **Manual connections** — add WebSocket or Unix socket URLs manually
- **Browser bridge** — sees browser providers announced by the Chrome extension
- **LLM chat** — chat with AI about any connected provider's state
- **State tree viewer** — inspect the live SLOP tree
- **Multi-provider** — connect to multiple providers simultaneously

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
