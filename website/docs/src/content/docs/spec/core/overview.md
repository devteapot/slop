---
title: "Overview & Concepts"
---
## The problem

AI systems interact with software in two modes today:

**Blind action.** The AI has a list of tools (functions) it can call. It acts without seeing. To learn what a user is looking at, it needs a dedicated tool for every observable. This doesn't scale — a rich application would require hundreds of read-only tools just to reconstruct state.

**Pixel observation.** The AI takes a screenshot and uses vision to interpret it. This is expensive (tokens per pixel), lossy (OCR errors, layout ambiguity), slow (round-trip for each observation), and fragile (UI changes break it).

Both modes exist because there is no standard way for an application to say: *"here is what I am right now."*

## The idea

SLOP is a protocol for applications to **expose their semantic state** to external observers (primarily AI systems).

An app that implements SLOP publishes a **state tree** — a structured, semantic representation of what it currently is and what can be done with it. An AI consumer connects, subscribes to the parts it cares about, and receives a stream of incremental updates.

The key properties:

- **Semantic, not visual.** The state tree describes meaning, not layout. A table is rows and columns of data, not a grid of pixels.
- **Push, not pull.** Once subscribed, the AI receives patches as state changes. No polling, no repeated queries.
- **Progressive.** The AI controls depth — a shallow subscription gets summaries, a deep one gets details. Token budget is respected.
- **Actionable.** State nodes carry affordances — the actions available in context. The AI sees what it can do alongside what it sees.

## Terminology

| Term | Definition |
|---|---|
| **Provider** | An application that exposes state via SLOP |
| **Consumer** | An AI system (or other client) that reads state via SLOP |
| **State tree** | The hierarchical, semantic data structure a provider publishes |
| **Node** | A single element in the state tree, with an ID, type, properties, children, and affordances |
| **Affordance** | An action available on a node — contextual, not global |
| **Subscription** | A consumer's request to observe a subtree at a given depth |
| **Patch** | An incremental update to the state tree (JSON Patch format) |
| **Salience** | A hint from the provider about how important/relevant a node is right now |
| **Depth** | How many levels deep into the tree a query or subscription resolves. `0` = this node only, `1` = this node + direct children, `-1` = unlimited |

## Design principles

### 1. State is the primitive
The protocol is built around reading state, not calling functions. Actions exist, but they are a secondary capability that lives *on* the state, not separate from it.

### 2. Semantic over structural
The state tree represents what the app *means*, not how it's built internally or how it renders. An email inbox exposes messages, not `<div>` elements or database rows.

### 3. Apps control the projection
The provider decides what to expose. SLOP doesn't require dumping internal state — it defines a contract for publishing a *view* of state, analogous to how a REST API doesn't expose the database.

### 4. Token-aware by design
Every design choice assumes the consumer has a finite context window. Progressive depth, summaries, windowed collections, and salience hints all exist to let the AI spend its token budget wisely.

### 5. Incremental by default
Full state snapshots are only for initial sync. After that, the protocol communicates changes, not state.

### 6. Transport agnostic
The protocol defines messages and semantics, not wire format. Implementations can use WebSockets, Unix sockets, stdio, or even files.

## Layers

SLOP has four conceptual layers:

```
┌─────────────────────────────┐
│  Attention & Salience       │  What matters right now
├─────────────────────────────┤
│  Affordances                │  What can be done
├─────────────────────────────┤
│  State Tree + Sync          │  What is + what changed
├─────────────────────────────┤
│  Transport & Discovery      │  How to connect
└─────────────────────────────┘
```

Each layer builds on the one below. A minimal implementation only needs the bottom two. A rich one uses all four.
