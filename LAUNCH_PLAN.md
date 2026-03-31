# SLOP 1.0 — Launch Media Plan

## Deliverables

1. [Hacker News article](#1-hacker-news)
2. [Twitter/X post](#2-twitterx)
3. [LinkedIn post](#3-linkedin)
4. [Reddit post](#4-reddit)
5. [GitHub README](#5-github-readme)
6. [Launch day coordination](#6-launch-day-coordination)

---

## Messaging

SLOP (State Layer for Observable Programs) is a protocol for applications to expose their semantic state to AI. The spec defines four layers: transport & discovery, state tree & sync, affordances, and attention & salience.

**Core pitch:** "SLOP is a protocol that gives AI structured, real-time awareness of application state — and contextual actions to match."

**The problem it solves:** AI interacts with apps through two extremes today. Screenshots are expensive, lossy, and fragile — the AI parses pixels to recover information the app already had in structured form. Tool calls (MCP, function calling) let AI act, but it acts blind — no awareness of what the user sees or what state the app is in.

**How SLOP differs from MCP:** MCP is action-first — a flat registry of tools the AI can call, disconnected from state. SLOP is state-first — apps publish a semantic state tree that AI subscribes to, and actions live on the nodes they affect (not in a global registry). They appear and disappear as state changes. A "merge" affordance only exists on a PR node when the PR is actually mergeable. MCP and SLOP solve different problems and can coexist.

**How SLOP differs from accessibility APIs:** Accessibility trees describe UI structure (buttons, text fields, labels). SLOP describes meaning — an email inbox exposes messages with subjects and senders, not a grid of `<div>` elements. SLOP is semantic, not structural.

**What ships:** 14-doc spec. 13 SDK packages across 4 languages (TypeScript: core, client, server, consumer, react, vue, solid, angular, tanstack-start, openclaw-plugin; Python; Rust; Go). A Chrome extension. Working examples (multi-language CLI task manager, React notes SPA, TanStack Start full-stack app). All MIT licensed.

---

## 1. Hacker News

**Title:** `Show HN: SLOP – A protocol for AI to observe and interact with application state`

**URL:** Points to the GitHub repo. HN rewards substance over marketing pages.

**First comment** (post immediately after submission):

> Hey HN — I built SLOP because AI agents interact with apps through two bad options: screenshots (expensive, lossy, fragile) or blind tool calls (no context about what the user is looking at or what state the app is in).
>
> SLOP is a protocol that fixes this. Apps expose a semantic state tree — structured, meaning-level data about what they currently are. AI subscribes to the parts it cares about and gets pushed incremental updates (JSON Patch). No polling, no pixel parsing.
>
> Actions are contextual — they live on the state nodes they affect, not in a flat global registry. A "merge" affordance appears on a PR node only when the PR is mergeable. A "reply" action lives on the message it replies to. Actions come and go as state changes, so the AI always sees what it can actually do.
>
> How it relates to MCP: MCP is action-first — the AI gets a list of tools to call. SLOP is state-first — the AI gets structured awareness of what the app is, then acts in context. They solve different problems and can coexist.
>
> The spec is 14 docs covering state trees, transport (WebSocket, Unix socket, stdio, postMessage), affordances, attention/salience hints, scaling, and integrations. SDKs in TypeScript (10 packages including React, Vue, Solid, Angular adapters), Python, Rust, and Go. There's a Chrome extension and working examples. All MIT.
>
> What I'd love feedback on: the state tree schema design, the affordance model (contextual actions vs global tools), and whether the transport/discovery choices make sense.
>
> Try it: the CLI task manager example (`examples/cli/`) has implementations in Bun, Python, Go, and Rust — each exposes the same SLOP tree over a Unix socket. The `--slop` flag is all it takes.

**Tone rules:**
- No hype words ("disrupting", "10x", "revolutionary")
- Be honest about limitations and what's missing
- Respond to every comment in the first 2 hours
- Be genuinely receptive to criticism — "good point, I'll add that to the spec" > defending
- Give thorough technical answers with links to relevant spec docs

---

## 2. Twitter/X

**Format:** Thread (5-6 tweets)

**Tweet 1 (hook):**
> AI agents interact with apps through two bad options:
>
> - Screenshots (expensive, lossy, fragile)
> - Blind tool calls (no awareness of app state)
>
> I built SLOP — a protocol that gives AI structured, real-time awareness of application state.
>
> Open source today. Here's the idea:

**Tweet 2 (how it works):**
> Apps expose a semantic state tree — structured data about what they are right now. Not pixels, not DOM, not database rows. Meaning.
>
> AI subscribes and gets pushed incremental updates (JSON Patch). No polling.
>
> Actions live on the nodes they affect — a "reply" action on a message, a "merge" action on a PR. They appear and disappear as state changes.

**Tweet 3 (vs MCP):**
> How does this relate to MCP?
>
> MCP is action-first: a flat registry of tools the AI can call, disconnected from state.
>
> SLOP is state-first: AI gets structured awareness of what the app is, then acts in context.
>
> Different problems. They can coexist.

**Tweet 4 (what ships):**
> What's in the box:
> - 14-doc spec (state trees, transport, affordances, attention, scaling)
> - 13 SDK packages: TypeScript (core + React/Vue/Solid/Angular/TanStack Start), Python, Rust, Go
> - Chrome extension
> - Examples in 4 languages
>
> All MIT licensed.

**Tweet 5 (demo):**
> [Demo GIF/video]
>
> The full loop: user changes state -> AI sees the update -> AI invokes a contextual action -> state updates again.

**Tweet 6 (CTA):**
> GitHub: [link]
> Spec: [link]
> Docs: [link]
>
> Feedback welcome — especially on the spec design.

---

## 3. LinkedIn

**Format:** Single post, professional tone, more context on the "why"

> I've open-sourced SLOP (State Layer for Observable Programs) — a protocol for AI to observe and interact with application state.
>
> The problem: AI agents interact with software through two extremes. Vision (screenshots) is expensive and lossy — the AI parses pixels to recover information the app already had in structured form. Tool calling (MCP, function calling) lets AI act, but with no awareness of what the user sees or what state the application is in.
>
> SLOP is a different approach. Applications expose a semantic state tree — structured, meaning-level data about what they currently are — that AI can subscribe to, query at variable depth, and act on through contextual affordances. Actions live on the state nodes they affect (not in a flat registry) and appear/disappear as state changes. The protocol is push-first, token-aware, and transport-agnostic.
>
> The spec is 14 documents covering state trees, transports (WebSocket, Unix socket, stdio, postMessage), affordances, attention/salience, scaling, and integration patterns. SDKs ship in TypeScript (10 packages including framework adapters for React, Vue, Solid, and Angular), Python, Rust, and Go. There's a Chrome extension and working examples.
>
> SLOP and MCP solve different problems — MCP is action-first (a registry of tools), SLOP is state-first (structured awareness with contextual actions). They can coexist.
>
> Everything is MIT licensed. Looking for feedback from developers, AI researchers, and anyone building agent tooling.
>
> [link to repo]

---

## 4. Reddit

### r/programming

**Title:** `Show r/programming: SLOP – A protocol for AI to observe and interact with application state (open source)`

**Body:**

> I've been working on SLOP (State Layer for Observable Programs) — an open protocol for apps to expose their semantic state to AI.
>
> **The core idea:** Apps publish a state tree — structured, meaning-level data about what they currently are. AI subscribes to the parts it cares about and gets pushed incremental updates (JSON Patch). Actions are contextual: they live on the state nodes they affect, not in a flat global registry. A "merge" affordance only appears on a PR node when the PR is actually mergeable.
>
> **How it relates to MCP:** MCP is action-first — the AI gets a list of tools to call, disconnected from app state. SLOP is state-first — the AI gets structured awareness and acts in context. Different problems, can coexist.
>
> **The spec** (14 docs) covers: state trees with progressive depth, transport (WebSocket, Unix socket, stdio, postMessage), affordances with JSON Schema params, attention/salience hints for token budget management, windowed collections, and async actions.
>
> **SDKs:** 10 TypeScript packages (core, client, server, consumer, React, Vue, Solid, Angular, TanStack Start, OpenClaw plugin), plus Python, Rust, and Go. Chrome extension included. Examples in 4 languages.
>
> MIT licensed. Feedback on the spec design welcome — especially the affordance model and transport choices.
>
> [GitHub link]

### r/LocalLLaMA

**Title:** `SLOP – A protocol for local LLMs to observe and interact with application state`

**Body:**

> I open-sourced SLOP (State Layer for Observable Programs) — a protocol for apps to expose structured state to AI, instead of relying on screenshots or blind tool calls.
>
> Apps publish a semantic state tree that your LLM can subscribe to and act on. Actions are contextual — they live on the nodes they affect and appear/disappear as state changes. Updates are incremental (JSON Patch), so your model's context window isn't wasted on redundant state dumps.
>
> The CLI task manager example (`examples/cli/`) has implementations in Bun, Python, Go, and Rust — each exposes the same SLOP tree over a Unix socket. The `--slop` flag is all it takes. The Chrome extension connects to SLOP providers and lets you interact with any SLOP-enabled app.
>
> 14-doc spec. SDKs in TypeScript (10 packages), Python, Rust, and Go. All MIT.
>
> Would love feedback from the local-first AI community — especially on transport choices and whether the protocol fits how you're building agents.
>
> [GitHub link]

---

## 5. GitHub README

The current README is already in good shape. Launch polish checklist:

- [ ] Add hero GIF/video at the top (15-20s showing the full loop: user action -> AI sees state change -> AI invokes affordance -> state updates)
- [ ] Verify all quick start code blocks work when copy-pasted
- [ ] Verify all spec links point to the new structure (core/, extensions/, integrations/)
- [ ] Add clear "try it" instructions with actual commands (e.g. `cd examples/cli/bun && bun install && bun run slop`)
- [ ] Verify all SDK links point to existing packages
- [ ] Add social preview image to repo settings (owl logo + tagline)
- [ ] Add GitHub topics: `ai`, `protocol`, `llm`, `agent`, `state-management`, `open-source`
- [ ] Ensure LICENSE file exists and is MIT
- [ ] Ensure CONTRIBUTING.md exists
- [ ] Add a root-level `demo` script to package.json so `bun run demo` works from the repo root

### README must answer in 10 seconds

1. **What is this?** — A protocol for AI to observe and interact with application state
2. **Why should I care?** — Screenshots are expensive, tool calls are blind, SLOP gives AI structured state awareness with contextual actions
3. **How is it different?** — Comparison table (already present — verify it's accurate)
4. **Can I try it now?** — Yes, with actual working commands

---

## 6. Launch day coordination

### Timing

- **Day:** Tuesday, Wednesday, or Thursday
- **Time:** 8-9am EST (peak HN traffic)
- **Avoid:** Mondays (crowded), Fridays (low engagement), weekends, days with major tech news

### Sequence (all within a 2-hour window)

| Time | Action |
|------|--------|
| T+0 | Push repo to public (if not already) |
| T+0 | Submit Show HN + post first comment immediately |
| T+15min | Post Twitter/X thread |
| T+30min | Post to r/programming |
| T+30min | Post to r/LocalLLaMA |
| T+45min | Post LinkedIn |
| T+2h | Check HN ranking, respond to all comments |
| T+6h | If HN front page, post update comment with stats/feedback |

### Pre-launch checklist

- [ ] Demo GIF/video recorded and embedded in README
- [ ] `bun run demo` works from repo root (add script to root package.json)
- [ ] All npm packages published and installable
- [ ] Python package published on PyPI
- [ ] Rust crate published
- [ ] Go module tagged
- [ ] Extension sideload instructions clear (Chrome Web Store takes days)
- [ ] All spec links verified (new core/extensions/integrations structure)
- [ ] Social preview image set on GitHub
- [ ] All post drafts finalized and ready to copy-paste
- [ ] 3-4 people briefed to leave genuine technical comments on HN (not upvotes — early discussion signals quality)

### HN engagement rules

- Respond to **every** comment in the first 2 hours (keeps the post active in ranking)
- Be receptive to criticism — "good point, I'll add that" > defending
- Give thorough technical answers with spec doc links
- If it hits front page, post an update comment at T+6h

### What kills an HN post

- Vote rings (HN detects and penalizes coordinated upvoting)
- Marketing language
- Broken demo link
- No source code
- Responding defensively to criticism

### Cross-platform amplification

If HN catches, the Reddit/Twitter posts amplify. If HN doesn't catch, the other platforms are independent shots on goal. Don't put all eggs in one basket.
