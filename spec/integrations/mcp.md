# MCP Interoperability

The Model Context Protocol (MCP) and SLOP solve overlapping but distinct problems:

- **MCP** is a tool-call RPC. A server advertises tools; a client (the model host) invokes them.
- **SLOP** is a state-observation protocol. A provider exposes a live state tree; a consumer subscribes to snapshots and patches.

MCP clients are already embedded in every major AI host (Claude, ChatGPT, Goose, VS Code). This document defines how SLOP interoperates with MCP so that SLOP providers can be adopted without requiring a host to add a new transport.

## Relationship to MCP

SLOP does not replace MCP and is not a fork of it. Three relationships are supported:

1. **MCP carries SLOP** — a SLOP session runs inside an MCP-hosted surface (see [MCP Apps bridge](#mcp-apps-bridge)).
2. **MCP proxies SLOP** — an MCP server translates MCP tool calls into SLOP affordance invocations against an upstream SLOP provider. This is the pattern used by the `claude-slop-mcp-proxy` integration.
3. **SLOP stands alone** — a SLOP provider is consumed directly over its native transports (WebSocket, Unix socket, postMessage, stdio). No MCP involvement.

Where MCP and SLOP overlap in 2026 — capability discovery via `.well-known`, explicit subscription streams, stateless sessions — SLOP's semantics are treated as authoritative for state; MCP's are authoritative for tool invocation.

## MCP Apps bridge

The MCP Apps extension (SEP-1865, Jan 2026) lets an MCP tool return a UI resource that the host renders in a sandboxed iframe. The host and iframe exchange JSON-RPC over `postMessage`.

This is the same transport SLOP already specifies for in-browser providers (see [transport.md](../core/transport.md)). An MCP Apps iframe is therefore a valid SLOP postMessage endpoint with one translation step.

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

An MCP Apps host exposes three JSON-RPC methods to the iframe:

| MCP Apps method | SLOP mapping |
|---|---|
| `app.callServerTool(name, args)` | Invoke an MCP tool. The bridge exposes one tool per SLOP affordance, or a single generic `slop.invoke` tool. |
| `app.updateModelContext(content)` | Emit a compact SLOP state projection so the host model sees current state. Bridge should send salience-filtered snapshots, not raw trees. |
| `app.ontoolresult(handler)` | Deliver `result` messages back to the iframe consumer. |

Inside the iframe the wire envelope is the standard SLOP postMessage form:

```jsonc
window.postMessage({ slop: true, message: { ... } }, "*");
```

The bridge adapter is responsible for demultiplexing: MCP Apps frames (no `slop` field) go to the MCP host; frames with `slop: true` go to the SLOP consumer.

### Provider location

Two deployment shapes are supported:

- **In-iframe provider** — client-only state lives inside the iframe bundle. The descriptor reports `{ "type": "postmessage" }`. No network egress from the iframe.
- **Remote provider** — the iframe runs only the consumer and a thin relay that forwards SLOP messages to an authoritative WebSocket provider. The relay must enforce the security rules in [transport.md](../core/transport.md): bridges are not the security boundary.

## MCP proxy (tool-call translation)

For hosts that do not yet support MCP Apps, a SLOP provider can be surfaced through a conventional MCP server. The proxy advertises either:

- **One tool per affordance** — dynamic tool list, richest UX, tool count scales with the tree.
- **Five generic tools** — `list_apps`, `connect_app`, `disconnect_app`, `app_action`, `app_action_batch` — stable tool catalog, lowest token overhead.

State is delivered to the model out of band (as injected context) rather than through MCP tools, because MCP has no native subscription primitive today. When MCP's explicit-subscription-stream work (see [MCP transports, Dec 2025](https://blog.modelcontextprotocol.io/posts/2025-12-19-mcp-transport-future/)) ships, the proxy may switch to streaming snapshots and patches over that channel.

Reference implementations live under `packages/typescript/integrations/claude/`.

## Discovery alignment

MCP 2026 introduces `.well-known` capability discovery so registries can learn what a server does without connecting. SLOP already specifies `/.well-known/slop` (see [transport.md](../core/transport.md)). Servers that speak both protocols SHOULD publish both descriptors:

```
GET /.well-known/slop   → SLOP descriptor (state-tree capable)
GET /.well-known/mcp    → MCP descriptor (tool-call capable)
```

A registry or agent picks the descriptor it speaks. The two files do not reference each other and do not imply combined semantics.

## Security boundary

An MCP host relaying SLOP messages — whether through MCP Apps or an MCP proxy — is a bridge, not an authority. The SLOP provider (or the backend behind it) MUST re-authorize every invoke against live state and caller identity, as required by [transport.md](../core/transport.md). Iframe sandboxing and MCP tool consent prompts are defense in depth, not a substitute for provider-side enforcement.

## Non-goals

- SLOP does not define an MCP extension SEP in this version. A future SEP ("SLOP over MCP") may register `experimental/slop` as an MCP capability and specify an `slop/subscribe` method once MCP's subscription-stream transport stabilizes.
- SLOP does not attempt to be rendered as an MCP tool list. The state tree is not a flat tool catalog, and flattening it defeats the purpose of the protocol.
