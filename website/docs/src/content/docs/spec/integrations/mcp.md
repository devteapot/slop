---
title: "MCP Interoperability"
---
The Model Context Protocol (MCP) and SLOP solve overlapping but distinct problems:

- **MCP** is a tool-call RPC. A server advertises tools; a client (the model host) invokes them.
- **SLOP** is a state-observation protocol. A provider exposes a live state tree; a consumer subscribes to snapshots and patches.

MCP clients are already embedded in many major AI hosts (Claude, ChatGPT, Goose, VS Code). This document defines how SLOP interoperates with MCP so that SLOP providers can be adopted without requiring every host to add a native SLOP transport first.

## Relationship to MCP

SLOP does not replace MCP and is not a fork of it. Three relationships are supported:

1. **MCP carries SLOP** — a SLOP session runs inside an MCP-hosted surface (see [MCP Apps bridge](#mcp-apps-bridge)).
2. **MCP proxies SLOP** — an MCP server translates MCP tool calls into SLOP affordance invocations against an upstream SLOP provider. This is the pattern used by the `claude-slop-mcp-proxy` integration.
3. **SLOP stands alone** — a SLOP provider is consumed directly over its native transports (WebSocket, Unix socket, postMessage, stdio). No MCP involvement.

Where MCP and SLOP overlap, SLOP's semantics are authoritative for live state trees, snapshots, patches, and affordance validity. MCP's semantics are authoritative for MCP tool invocation, MCP resources, MCP Apps, and host consent flows. Roadmap MCP work around server metadata, stateless sessions, and event-driven updates can improve the bridge shape, but bridge implementations MUST NOT assume those features are part of the current MCP core spec until they ship.

## MCP Apps bridge

The MCP Apps extension (SEP-1865, Jan 2026) lets an MCP tool return a UI resource that the host renders in a sandboxed iframe. The host and iframe exchange JSON-RPC over `postMessage`.

This is the same transport SLOP already specifies for in-browser providers (see [transport.md](/spec/core/transport)). An MCP Apps iframe is therefore a valid SLOP postMessage endpoint with one translation step.

### Bridge shape

```
┌─ MCP host (Claude / ChatGPT / VS Code) ──────────────────────┐
│                                                               │
│   MCP client ──► call tool "open_slop_view"                  │
│        │                                                       │
│        ▼                                                       │
│   MCP server returns _meta.ui.resourceUri = "ui://slop/..."   │
│        │                                                       │
│   ┌────▼─────────────────────────────────────┐               │
│   │  Sandboxed iframe                         │               │
│   │  ┌─────────────────────────────────────┐ │               │
│   │  │ @slop-ai/spa consumer               │ │               │
│   │  │          ▲                          │ │               │
│   │  │          │ postMessage              │ │               │
│   │  │          ▼                          │ │               │
│   │  │ SLOP provider (in-iframe)           │ │               │
│   │  │   or proxy → remote WS provider     │ │               │
│   │  └─────────────────────────────────────┘ │               │
│   └──────────────────────────────────────────┘               │
└───────────────────────────────────────────────────────────────┘
```

### Required translation

The `@modelcontextprotocol/ext-apps` `App` helper exposes convenience APIs over the MCP Apps JSON-RPC `postMessage` channel. A SLOP bridge should map those helper APIs to SLOP behavior as follows:

| MCP Apps helper API | SLOP mapping |
|---|---|
| `app.callServerTool(name, args)` | Invoke an MCP tool. The bridge exposes one tool per SLOP affordance, or a single generic `slop.invoke` tool. |
| `app.updateModelContext(content)` | Emit a compact SLOP state projection so the host model sees current state. Bridge should send salience-filtered snapshots, not raw trees. |
| `app.addEventListener("toolresult", handler)` | Deliver `result` messages back to the iframe consumer. (The legacy `app.ontoolresult` setter still works but is deprecated in `@modelcontextprotocol/ext-apps`.) |

Inside the iframe the wire envelope is the standard SLOP postMessage form:

```jsonc
window.postMessage({ slop: true, message: { ... } }, "*");
```

The bridge adapter is responsible for demultiplexing: MCP Apps frames (no `slop` field) go to the MCP host; frames with `slop: true` go to the SLOP consumer.

### Provider location

Two deployment shapes are supported:

- **In-iframe provider** — client-only state lives inside the iframe bundle. The descriptor reports `{ "type": "postmessage" }`. No network egress from the iframe.
- **Remote provider** — the iframe runs only the consumer and a thin relay that forwards SLOP messages to an authoritative WebSocket provider. The relay must enforce the security rules in [transport.md](/spec/core/transport): bridges are not the security boundary.

## Current MCP primitives

SLOP bridges should use shipped MCP primitives before inventing new extension points:

- **Streamable HTTP** — remote MCP servers can use POST and GET with optional SSE streams. SSE event IDs, `Last-Event-ID`, and `MCP-Session-Id` provide a transport-level basis for reconnect and redelivery, but they do not define SLOP snapshot or patch semantics.
- **Resources** — a bridge MAY expose selected SLOP snapshots, node projections, or `content_ref` targets as MCP resources. If the host supports `resources/subscribe`, the bridge can notify the client that a resource changed; the client still re-reads the resource and the model still needs a host policy for whether that resource enters context.
- **Tools** — SLOP affordances map cleanly to MCP tools, either one tool per affordance or a generic invoke tool. Tool calls MUST still be re-authorized by the SLOP provider against live state.
- **Tasks** — where an MCP host supports MCP's experimental task primitive, async SLOP affordances can expose task-like progress and completion results. This is optional; SLOP's `accepted` result remains the protocol source of truth for SLOP consumers.

## MCP proxy (tool-call translation)

For hosts that do not yet support MCP Apps, a SLOP provider can be surfaced through a conventional MCP server. The proxy advertises either:

- **One tool per affordance** — dynamic tool list, richest UX, tool count scales with the tree.
- **Five generic tools** — `list_apps`, `connect_app`, `disconnect_app`, `app_action`, `app_action_batch` — stable tool catalog, lowest token overhead.

State is usually delivered to the model out of band as injected context rather than through MCP tools. Current MCP resource subscriptions and Streamable HTTP SSE can notify clients about changes, but they do not standardize a model-visible SLOP state-tree subscription that streams snapshots and patches into host context. A proxy MAY expose state as MCP resources and use `resources/subscribe` where supported, but it must preserve SLOP versioning, salience filtering, and provider-side authorization.

### Research connector facade

Some research-oriented MCP integrations, including OpenAI Deep Research and ChatGPT company knowledge, require a read-only `search` / `fetch` tool pair instead of a broad action surface. A SLOP provider can support those hosts by publishing a companion MCP server with:

- `search(query)` — returns stable IDs, titles, URLs, and snippets for matching SLOP nodes, content references, documents, or app records.
- `fetch(id)` — returns the full text and metadata for one result.

This facade is not a live-control bridge. It is an adoption path for deep-research and company-knowledge workflows where the model needs citable read access to SLOP-backed state, not direct affordance invocation.

Reference implementations live under `packages/typescript/integrations/claude/`.

## Discovery alignment

The MCP 2026 roadmap calls for a standard metadata format served via `.well-known` so registries can learn what a server does without connecting. That metadata format is roadmap work, not part of the current MCP core spec. SLOP already specifies `/.well-known/slop` (see [transport.md](/spec/core/transport)).

Servers that speak both protocols SHOULD publish the SLOP descriptor and the MCP metadata accepted by their target MCP registries or hosts. If MCP standardizes a root `.well-known` capability descriptor, a dual-speaking server can publish both:

```
GET /.well-known/slop   -> SLOP descriptor (state-tree capable)
GET /.well-known/mcp    -> MCP descriptor, if standardized by MCP
```

A registry or agent picks the descriptor it speaks. The two files do not reference each other unless a future MCP extension defines combined semantics.

## Security boundary

An MCP host relaying SLOP messages — whether through MCP Apps or an MCP proxy — is a bridge, not an authority. The SLOP provider (or the backend behind it) MUST re-authorize every invoke against live state and caller identity, as required by [transport.md](/spec/core/transport). Iframe sandboxing and MCP tool consent prompts are defense in depth, not a substitute for provider-side enforcement.

## Non-goals

- SLOP does not define an MCP extension SEP in this version. A pre-sponsor draft titled "SLOP over MCP" — registering `experimental/slop` as an MCP capability and specifying `slop/subscribe` / `slop/unsubscribe` / `slop/invoke` methods plus snapshot, patch, and attention notifications — is kept in-repo at [`seps/0000-slop-over-mcp.md`](https://github.com/devteapot/slop/blob/main/seps/0000-slop-over-mcp.md). It will be submitted to the MCP SEP directory once it has a sponsor and a reference implementation.
- SLOP does not attempt to be rendered as an MCP tool list. The state tree is not a flat tool catalog, and flattening it defeats the purpose of the protocol.
