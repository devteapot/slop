---
title: Installation
description: Install SLOP packages for your framework
---

## Core + Client packages

Every SLOP integration starts with `@slop-ai/client` (which depends on `@slop-ai/core`):

```bash
bun add @slop-ai/client
# or: npm install @slop-ai/client
```

`@slop-ai/client` gives you `createSlop`, `register`, `unregister`, `scope`, and typed schemas. `@slop-ai/core` is the shared engine — it exports types and helpers (`action`, `pick`, `omit`, `NodeDescriptor`) but `createSlop` lives in `@slop-ai/client`. Both work in any JavaScript environment (browser, Node, Bun, Deno).

## Framework adapters

Add the adapter for your framework:

| Framework | Package | Install |
|---|---|---|
| React | `@slop-ai/react` | `bun add @slop-ai/react` |
| Vue 3 | `@slop-ai/vue` | `bun add @slop-ai/vue` |
| SolidJS | `@slop-ai/solid` | `bun add @slop-ai/solid` |
| Angular 16+ | `@slop-ai/angular` | `bun add @slop-ai/angular` |
| Svelte 5 | — | Use `@slop-ai/client` directly |
| Vanilla JS | — | Use `@slop-ai/client` directly |

Svelte and vanilla JS don't need an adapter — `$effect` + `onDestroy` (Svelte) or `store.subscribe` (vanilla) map directly to `register`/`unregister`. Use `@slop-ai/client` directly.

## Server packages

For server-backed and native apps:

| Package | Use case |
|---|---|
| `@slop-ai/server` | Server provider — WebSocket, Unix socket, stdio |
| `@slop-ai/tanstack-start` | TanStack Start adapter — full integration |

```bash
bun add @slop-ai/server
# or for TanStack Start:
bun add @slop-ai/server @slop-ai/tanstack-start
```

## Consumer package

For building AI agents or tools that connect to SLOP providers:

```bash
bun add @slop-ai/consumer
```

This includes `SlopConsumer`, `StateMirror`, transport implementations (WebSocket, postMessage), and LLM tool utilities.

## Browser extension

The SLOP Chrome extension discovers providers on any web page and provides an AI chat overlay.

1. Download from the [Chrome Web Store](#) (coming soon)
2. Or sideload: clone the repo, `cd extension && bun run build.ts`, load `extension/` as unpacked in `chrome://extensions`

## Desktop app

The SLOP desktop app connects to all your providers — local apps, web apps, and SPAs through the extension bridge.

1. Download from [Releases](#) (coming soon)
2. Or build from source: `cd desktop && bunx tauri dev`
