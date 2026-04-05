# SLOP — State Layer for Observable Programs

SLOP is a protocol that lets AI observe and interact with application state directly — no screenshots, no scraping, no blind tool calls.

Applications expose a **semantic state tree** that AI can subscribe to, query at variable depth, and act on through **contextual affordances**. It is the missing perception layer between AI and the software it operates.

https://github.com/user-attachments/assets/738add8c-8c06-4e5c-a85d-1e81e7472354

> An AI agent observing state, invoking actions, and updating the UI in real time. Run it yourself: `bun run demo`

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

## Quick start

```bash
bun add @slop-ai/client @slop-ai/react
```

```tsx
import { createSlop } from "@slop-ai/client";
import { action, useSlop } from "@slop-ai/react";

const slop = createSlop({ id: "my-app", name: "My App" });

function TaskList({ tasks }) {
  useSlop(slop, "tasks", () => ({
    type: "collection",
    props: { count: tasks.length },
    items: tasks.map(t => ({
      id: t.id,
      props: { title: t.title, done: t.done },
      actions: {
        toggle: action(() => toggleTask(t.id)),
        delete: action(() => deleteTask(t.id), { dangerous: true }),
      },
    })),
  }));

  return <ul>{tasks.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

That's it. Your component is now observable by any SLOP consumer — the Chrome extension, a desktop agent, or a custom AI integration.

## Spec

The full specification is in [`spec/`](./spec/):

### Core protocol

1. [Overview & Concepts](./spec/core/overview.md)
2. [State Tree](./spec/core/state-tree.md)
3. [Transport & Discovery](./spec/core/transport.md)
4. [Message Protocol](./spec/core/messages.md)
5. [Affordances](./spec/core/affordances.md)
6. [Attention & Salience](./spec/core/attention.md)
### Extensions

- [Scaling](./spec/extensions/scaling.md) — windowing, pagination, view-scoped trees
- [Content References](./spec/extensions/content-references.md) — lazy-loaded media, URI schemes
- [Async Actions](./spec/extensions/async-actions.md) — long-running operations, progress tracking

### Integration guides

- [Adapters](./spec/integrations/adapters.md) — wrapping existing apps
- [Web](./spec/integrations/web.md) — browser integration, postMessage, security tiers
- [Desktop](./spec/integrations/desktop.md) — Unix sockets, native messaging
### Status and limits

- [Known Limitations & Future Work](./spec/limitations.md) — current gaps, reserved protocol areas, and roadmap notes
### SDK guides

- [Development & Debugging](./docs/sdk/development.md) — `printTree()`, schema validation, message logging
- [Sessions & Multi-User](./docs/sdk/sessions.md) — session-scoped trees, multi-user scaling, provider patterns

### Guides

- [Agent-Assisted Integration](./docs/guides/advanced/agent-scaffolding.md) — AI-powered SLOP scaffolding for existing codebases
- [OpenClaw Integration](./docs/guides/advanced/openclaw.md) — control SLOP apps from WhatsApp, Telegram, Slack via OpenClaw

## Benchmarks

The [`benchmarks/mcp-vs-slop`](./benchmarks/mcp-vs-slop) suite compares SLOP and MCP head-to-head using an identical backing application (issue tracker). An LLM agent performs 12 scenarios through each protocol, measuring correctness, tool calls, latency, and cost.

Key findings:

- **Correctness:** SLOP passes 12/12 scenarios. MCP passes 8/12 — fails on scale (discovery budget exhaustion), safety (can't prevent invalid actions on closed issues), and complex reasoning (can't aggregate state across repos).
- **Contextual affordances prevent invalid actions by design.** MCP's flat tool list always exposes `assign_issue` regardless of issue state. SLOP only shows actions valid for the current state.
- **SLOP uses 75-90% fewer LLM round trips** on multi-entity tasks by front-loading state. The agent batches all actions in 2 turns instead of 8-21 discovery-then-act turns.
- **Cost tradeoff is real.** SLOP's state tree uses more input tokens. For simple tasks MCP is cheaper. For complex tasks requiring cross-entity reasoning, SLOP is cheaper *and* correct where MCP fails.

Full results and methodology: [Benchmarks: MCP vs SLOP](https://docs.slopai.dev/guides/advanced/benchmarks/)

## SDKs

| Language | Package | Install |
|----------|---------|---------|
| TypeScript | [`@slop-ai/core`](./packages/typescript/sdk/core) | `bun add @slop-ai/core` |
| Browser | [`@slop-ai/client`](./packages/typescript/sdk/client) | `bun add @slop-ai/client` |
| React | [`@slop-ai/react`](./packages/typescript/adapters/react) | `bun add @slop-ai/react` |
| Vue | [`@slop-ai/vue`](./packages/typescript/adapters/vue) | `bun add @slop-ai/vue` |
| Solid | [`@slop-ai/solid`](./packages/typescript/adapters/solid) | `bun add @slop-ai/solid` |
| Angular | [`@slop-ai/angular`](./packages/typescript/adapters/angular) | `bun add @slop-ai/angular` |
| Svelte | [`@slop-ai/svelte`](./packages/typescript/adapters/svelte) | `bun add @slop-ai/svelte` |
| Server (Node/Bun) | [`@slop-ai/server`](./packages/typescript/sdk/server) | `bun add @slop-ai/server` |
| Consumer | [`@slop-ai/consumer`](./packages/typescript/sdk/consumer) | `bun add @slop-ai/consumer` |
| TanStack Start | [`@slop-ai/tanstack-start`](./packages/typescript/adapters/tanstack-start) | `bun add @slop-ai/tanstack-start` |
| Discovery | [`@slop-ai/discovery`](./packages/typescript/integrations/discovery) | `bun add @slop-ai/discovery` |
| OpenClaw | [`@slop-ai/openclaw-plugin`](./packages/typescript/integrations/openclaw-plugin) | `bun add @slop-ai/openclaw-plugin` |
| Python | [`slop-ai`](./packages/python/slop-ai) | `pip install slop-ai` |
| Rust | [`slop-ai`](./packages/rust/slop-ai) | `cargo add slop-ai` |
| Go | [`slop-ai`](./packages/go/slop-ai) | `go get github.com/devteapot/slop/packages/go/slop-ai` |

## Project structure

```
slop/
├── spec/                           # Protocol specification
├── docs/sdk/                       # SDK architecture & implementation guides
├── packages/
│   ├── typescript/
│   │   ├── sdk/
│   │   │   ├── core/               # @slop-ai/core — types, tree assembly, diffing
│   │   │   ├── client/             # @slop-ai/client — browser provider (postMessage)
│   │   │   ├── server/             # @slop-ai/server — server provider (WebSocket, Unix, stdio)
│   │   │   └── consumer/           # @slop-ai/consumer — connect, subscribe, invoke
│   │   ├── adapters/
│   │   │   ├── react/              # @slop-ai/react — useSlop hook
│   │   │   ├── vue/                # @slop-ai/vue — useSlop composable
│   │   │   ├── solid/              # @slop-ai/solid — useSlop primitive
│   │   │   ├── angular/            # @slop-ai/angular — useSlop with signals
│   │   │   ├── svelte/             # @slop-ai/svelte — useSlop for Svelte 5 runes
│   │   │   └── tanstack-start/     # @slop-ai/tanstack-start — SSR adapter
│   │   └── integrations/
│   │       ├── discovery/          # @slop-ai/discovery — provider discovery + agent tool helpers
│   │       ├── claude-slop-plugin/ # Claude Code plugin (MCP bridge, hooks, skills)
│   │       └── openclaw-plugin/    # @slop-ai/openclaw-plugin — OpenClaw integration
│   ├── python/slop-ai/             # Python SDK
│   ├── rust/slop-ai/               # Rust SDK
│   └── go/slop-ai/                 # Go SDK
├── apps/
│   ├── extension/                  # Chrome extension (SLOP consumer + AI chat)
│   ├── desktop/                    # Tauri desktop app
│   └── cli/                        # Go CLI inspector
├── benchmarks/
│   └── mcp-vs-slop/               # MCP vs SLOP benchmark suite
├── examples/
│   ├── cli/                        # Task manager CLI in 4 languages (Bun, Python, Go, Rust)
│   ├── spa/                        # Client-only kanban board across 5 frameworks
│   │   ├── react/
│   │   ├── vue/
│   │   ├── solid/
│   │   ├── svelte/
│   │   └── angular/
│   ├── desktop/                    # Pomodoro desktop provider (same blueprint, multiple stacks)
│   │   ├── typescript/           # Electron (JS main/renderer) + Unix socket provider
│   │   ├── python/
│   │   ├── go/
│   │   └── rust/                   # Tauri
│   └── full-stack/
│       ├── tanstack-start/         # TanStack Start — server + UI mount
│       └── python-react/           # Python FastAPI + React — cross-SDK
└── website/
    ├── landing/                    # slopai.dev landing page
    ├── docs/                       # docs.slopai.dev documentation
    ├── demo/                       # demo.slopai.dev interactive demo
    └── playground/                 # playground.slopai.dev
```

## Examples

Each example follows a **blueprint** — a language-agnostic spec defining the exact SLOP tree, affordances, and test scenarios. Multiple implementations of the same blueprint prove cross-language consistency.

- **[Interactive Demo](./website/demo/)** — Three-panel demo: e-commerce store + AI agent + live state tree. Run with `bun run demo`. Replay mode works without an API key; connect one for interactive mode.
- **[CLI Task Manager](./examples/cli/)** — `tsk`, a task manager with a `--slop` flag. Implementations in Bun, Python, Go, and Rust.
- **[SPA Kanban Board](./examples/spa/react/)** — Canonical client-only example, implemented in React, Vue, Solid, Svelte, and Angular from the same blueprint.
- **[TanStack Start](./examples/full-stack/tanstack-start/)** — Full-stack web app with server-side SLOP via WebSocket.
- **[Python + React](./examples/full-stack/python-react/)** — Python FastAPI backend + React SPA frontend. Cross-SDK integration with two independent providers.
- **[Desktop Pomodoro (TypeScript)](./examples/desktop/typescript/)** — Electron app as a SLOP provider (Unix socket + `~/.slop/providers/`). Implementations also exist in [Python](./examples/desktop/python/), [Go](./examples/desktop/go/), and [Rust/Tauri](./examples/desktop/rust/).

## Known limitations

SLOP v0.1 is designed to be useful now while leaving room to grow. Key limitations:

- **Multi-user apps** — Server-side providers currently expose one shared tree to all consumers. The protocol already supports per-user state (each connection is independent), but the SDKs don't implement session-scoped tree rendering yet. Client-only SPAs are unaffected — each tab is its own provider. See [Sessions & Multi-User](./docs/sdk/sessions.md).
- **No reconnection** — If a WebSocket drops, the consumer must re-connect and re-subscribe from scratch. No automatic reconnect or version-based catch-up.
- **No backpressure** — `pause`/`resume` messages are mentioned in the spec but not defined. Providers should debounce rapid changes (50-100ms).
- **No network discovery** — mDNS/DNS-SD is reserved but unspecified. Remote providers require manual configuration.

Full list: [Known Limitations & Future Work](https://docs.slopai.dev/spec/limitations/)

## Roadmap

**Protocol**
- Backpressure (`pause`/`resume` flow control)
- Network discovery (mDNS/DNS-SD)
- Ancestor retention for salience filtering
- Binary encoding (optional MessagePack/CBOR)

**SDKs**
- Session-scoped trees (multi-user server apps)
- Automatic reconnection with version catch-up
- Typed affordance results
- Consumer-side tree composition (merge multiple providers)

**Product**
- Firefox extension
- Safari extension
- OpenClaw integration
- Agent CLI (`npx @slop-ai/init`)
- Extension per-site toggles

## License

MIT
