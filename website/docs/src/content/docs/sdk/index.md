---
title: "SDK Architecture Guides"
---
Implementation guidance for SLOP SDK developers. These documents cover how to build providers and consumers — the internal architecture of the SDKs, not the wire protocol.

The [protocol spec](../../spec/) defines what flows over the wire. These guides define how SDKs should build, serve, and debug state trees internally.

## Documents

- **[Discovery & Bridge](/sdk/discovery)** — Provider scanning, extension bridge client/server, relay transport, auto-connect, state formatting. Language-agnostic specification for the discovery layer that sits above the consumer SDK.

- **[Development & Debugging](/sdk/development)** — `printTree()`, wire-format inspection, schema validation, message logging, common debugging scenarios.

- **[Sessions & Multi-User](/sdk/sessions)** — How SDKs handle multi-user server apps. Covers session-scoped trees vs provider-per-session, scaling tradeoffs, session-aware descriptors, scoped refresh, and meta-framework adapter patterns.

## Related spec content

Some spec documents contain SDK-specific sections alongside protocol definitions:

- **[Web Integration](/spec/integrations/web)** — Package architecture (layers 0–4), `createSlop()` / `createSlopServer()` API, descriptor format, `useSlop()` hooks, typed schema, scoped clients, framework adapters, transport adapters, meta-framework helpers.

- **[Scaling](/spec/extensions/scaling)** — The "Developer API for scaling" section covers `slop.register()` patterns for summaries, windowed collections, depth control, and salience in descriptors.

These remain in the spec because they're tightly interleaved with protocol concepts. The SDK-specific sections are clearly marked.
