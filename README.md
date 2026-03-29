# SLOP — State Layer for Observable Programs

SLOP is a protocol that lets AI observe and interact with application state directly — no screenshots, no scraping, no blind tool calls.

Applications expose a **semantic state tree** that AI can subscribe to, query at variable depth, and act on through **contextual affordances**. It is the missing perception layer between AI and the software it operates.

## Why

Today, AI interacts with applications through two extremes:

- **Vision** (screenshots) — expensive, lossy, fragile. The AI parses pixels to recover information the app already had in structured form.
- **Tool calls / MCP** — the AI can act, but it's flying blind. It calls functions without knowing what the user is currently looking at or what the app's state is. Every observation requires a dedicated tool.

SLOP fills the gap: a standard way for apps to **publish what they are** so AI can **see before it acts**.

## Core ideas

1. **State tree** — Apps expose a tree of semantic nodes (not UI elements, not raw data models — meaning). Each node has an identity, properties, and optional children.

2. **Subscriptions and patches** — AI subscribes to subtrees at a chosen depth. The app pushes incremental patches (JSON Patch) as state changes. No polling, no redundant full reads.

3. **Contextual affordances** — Actions live on the nodes they affect, not in a global tool registry. The AI sees what it can do *in context* — "reply" appears on a message node, "merge" appears on a PR node.

4. **Attention hints** — Apps signal what matters right now: salience scores, change flags, user focus. The AI doesn't have to scan the entire tree to find what's relevant.

5. **Progressive disclosure** — The tree supports variable-depth queries. Top-level gives a summary. Drilling in gives detail. Large collections are windowed with summaries.

## How it differs from existing approaches

| | MCP / Tool calls | Accessibility APIs | SLOP |
|---|---|---|---|
| Primary purpose | AI acts | Screen readers read UI | AI perceives + acts |
| Data model | Flat list of functions | UI element tree | Semantic state tree |
| Direction | Pull (AI calls tools) | Pull (reader queries) | Push-first (app publishes) |
| Actions | Global tool registry | Limited (click, type) | Contextual affordances on nodes |
| Designed for | LLM function calling | Sequential text navigation | AI state comprehension |

## Spec

The full specification is in [`spec/`](./spec/):

1. [Overview & Concepts](./spec/01-overview.md)
2. [State Tree](./spec/02-state-tree.md)
3. [Transport & Discovery](./spec/03-transport.md)
4. [Message Protocol](./spec/04-messages.md)
5. [Affordances](./spec/05-affordances.md)
6. [Attention & Salience](./spec/06-attention.md)
7. [Adapters](./spec/07-adapters.md)
8. [Web Integration](./spec/08-web-integration.md)
9. [Scaling](./spec/09-scaling.md)
10. [Desktop Integration](./spec/10-desktop-integration.md)
11. [Agent-Assisted Integration](./spec/11-agent-integration.md)
12. [OpenClaw Integration](./spec/12-openclaw-integration.md)
13. [Content References](./spec/13-content-references.md)

## Project structure

```
slop/
├── spec/                        ← the protocol specification (language-agnostic)
│   ├── 01-overview.md
│   └── ...11 docs
│
├── packages/                    ← publishable npm packages
│   ├── core/                    ← @slop-ai/core — browser client (createSlop, register, typed schema)
│   ├── consumer/                ← @slop-ai/consumer — connect to providers, subscribe, invoke
│   ├── react/                   ← @slop-ai/react — useSlop hook
│   ├── vue/                     ← @slop-ai/vue — useSlop composable
│   ├── solid/                   ← @slop-ai/solid — useSlop primitive
│   └── angular/                 ← @slop-ai/angular — useSlop with signals
│
├── extension/                   ← Chrome extension (SLOP consumer + LLM chat)
│
├── examples/                    ← runnable demos
│   ├── kanban/                  ← server-backed web app with SLOP
│   ├── notes-spa/               ← React SPA with in-browser SLOP provider
│   ├── todo-cli/                ← CLI provider + consumer
│   └── agent/                   ← LLM agent that observes and acts via SLOP
│
├── desktop/                     ← Tauri desktop app
│
└── mvp/                         ← prototyping sandbox
```

## Roadmap

### Post-launch
- Firefox extension
- Safari extension
- Python SDK (`slop-py`)
- OpenClaw integration
- Agent CLI (`npx @slop-ai/init`)
- Extension Tier 3: accessibility tree adapter (works on any website)
- Extension per-site toggles (enable/disable SLOP per domain, like an ad blocker)
- Desktop app (Tauri)

## Status

Early spec + working MVP. Everything is subject to change.
