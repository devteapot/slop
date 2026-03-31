# SLOP Interactive Demo

A three-panel web app that demonstrates the full SLOP protocol loop: an e-commerce store (provider), an AI agent (consumer), and a live state tree viewer — all running in the browser with no server.

## Quick start

```bash
bun install
bun demo    # from repo root, or:
cd examples/demo && bunx vite --port 3001
```

Open http://localhost:3001.

## What it shows

```
+-------------------+------------------+-----------------+
|   Application     |   AI Agent Chat  |   State Tree    |
|                   |                  |                 |
|  E-commerce store |  Conversation    |  Live SLOP tree |
|  (SLOP provider)  |  (consumer)      |  with patches   |
+-------------------+------------------+-----------------+
```

**Left panel** — A mini e-commerce store with product catalog, search, filters, product details, reviews, and shopping cart. This is the SLOP provider: all state is registered via `useSlop()` and exposed as a semantic tree with contextual affordances.

**Center panel** — An AI agent chat. In replay mode, a scripted conversation demonstrates the protocol. In interactive mode, a real LLM connects via API and uses SLOP tools to observe state and invoke actions.

**Right panel** — The raw SLOP state tree, updated in real-time via the protocol's push-based subscription model. Nodes flash green when patches arrive. Dangerous actions are highlighted in red.

**Status bar** — Color-coded indicator showing who is acting (AI observing, AI invoking, app updating, user interaction).

## Two modes

### Replay (default)

A scripted AI conversation plays automatically:
1. User asks for wireless headphones under $100
2. AI searches the catalog, views product details, adds to cart
3. AI writes a review based on product specs
4. User browses the store directly (click indicators show interactions)
5. AI observes the user's changes

Click **Skip** in the status bar to jump to the end state.

### Interactive (with API key)

Click **Connect API** → enter your API key → select a provider and model → **Connect**.

Supported providers:
- **OpenRouter** (recommended — browser CORS friendly, many models)
- **OpenAI**
- **Anthropic**
- **Google Gemini**

The AI agent uses SLOP tools derived from `affordancesToTools()` to interact with the store. It can search products, view details, manage the cart, write reviews, and navigate — all through the protocol's invoke mechanism.

## How it's built

### Architecture

The entire demo runs in-browser with no server, no WebSocket, no extension.

- **Provider**: `SlopClientImpl` from `@slop-ai/client` with an `InMemoryTransport` (no network transport — messages stay in-process)
- **State**: React `useState` + `useSlop()` registrations that produce the SLOP tree
- **Tree panel**: Subscribes via SLOP protocol messages (`subscribe` → `snapshot` → `patch`) through the in-memory transport
- **AI agent**: Sends SLOP protocol messages directly (`connect`, `subscribe`, `invoke`) through the same transport — identical wire format to a real WebSocket consumer
- **LLM integration**: Ported from the extension's battle-tested `llm.ts` with proper message format conversion for each provider

### Protocol compliance

The demo uses real SLOP protocol messages throughout:

```
Provider (SlopClientImpl)
    ↕ InMemoryTransport (same message format as WebSocket)
Tree Panel: subscribe → snapshot → patch (push-based updates)
AI Agent:   connect → subscribe → invoke → result (standard protocol)
```

One React-specific constraint: handlers call `setState` which is async, so there's a brief delay between invoke and tree update that doesn't exist in server-side providers. This is documented in the code — it's a rendering constraint, not a protocol deviation.

### Key files

| File | Purpose |
|------|---------|
| `src/slop.ts` | In-memory SLOP provider + transport |
| `src/state.ts` | E-commerce data model + `useSlop()` registrations |
| `src/ai/agent.ts` | AI agent loop using direct SLOP protocol messages |
| `src/ai/provider.ts` | Multi-provider LLM API (ported from extension) |
| `src/replay/script.ts` | Scripted replay steps |
| `src/replay/player.ts` | Replay engine with typewriter effect |
| `src/panels/AppPanel.tsx` | E-commerce UI |
| `src/panels/ChatPanel.tsx` | Chat interface + API config |
| `src/panels/TreePanel.tsx` | Live state tree viewer |

### Design system

Follows DESIGN.md — dark theme (`#111319`), neon green accents (`#91db37`), Space Grotesk + JetBrains Mono, glassmorphism, no borders (tonal layering).
