---
title: "LLM Context Injection"
---
SLOP exposes live application state. To make that state visible to a language model, a consumer must serialize the current tree into the model's context window on every turn. Done naively, this either bloats the conversation history (every past state lingers forever) or breaks prompt caching (every turn invalidates the prefix). This document defines the conventions a SLOP-aware LLM host SHOULD follow so that state stays fresh, history stays clean, and the cache stays warm.

This is an integration concern, not part of the core protocol. Providers do not need to know how their state is rendered into a prompt. Consumers that do not interface with an LLM (analytics tools, replay, headless tests) MAY ignore this document entirely.

## The problem

A SLOP consumer driving a model has two pressures that pull in opposite directions:

- **Freshness** — the model must reason about state *now*, not whatever the tree looked like ten turns ago.
- **Efficiency** — the conversation prefix must be stable enough to hit the provider's prompt cache, otherwise every turn re-bills the entire history.

Embedding the full tree into each user message satisfies freshness but defeats caching: the prefix changes every turn. Snapshotting once and never refreshing satisfies caching but leaves the model reasoning over stale state. Neither is acceptable for an interactive agent.

## The pattern: ephemeral state tail

The recommended pattern is to treat current state as an **ephemeral tail** appended to the request, never persisted into conversation history.

```
┌─ Stable conversation history ───────────────────────────┐
│  system prompt                                          │
│  user: "find the unread thread from alice"              │
│  assistant: "opening it now" + tool call                │
│  tool result                                            │
│  user: "reply with 'on it'"                             │  ← cache boundary, when supported
└─────────────────────────────────────────────────────────┘
┌─ Ephemeral tail (rebuilt every turn) ───────────────────┐
│  <slop-state>                                           │
│    ...current SLOP tree projection...                   │
│  </slop-state>                                          │
└─────────────────────────────────────────────────────────┘
```

Rules:

1. The conversation history MUST contain only messages — user input, assistant output, tool calls, tool results. It MUST NOT contain state-tail blocks from prior turns.
2. The current state projection is rendered fresh on every request and appended after the last stored message.
3. When the next turn arrives, the previous state tail is discarded by construction (it was never stored). The new tail reflects the current tree.

Because old state is never written into history, no removal step is required. The consumer holds one mutable reference to the live tree, and the prompt builder reads it at request time.

## The `<slop-state>` tag

State SHOULD be delimited by an explicit `<slop-state>` ... `</slop-state>` tag, analogous to the framing used for tool definitions and tool results. This gives the model a stable signal for "this region is the live SLOP observation, not part of the conversation."

```
<slop-state generated_at="2026-04-28T10:30:00Z" format="text/tree">
## SLOP Apps

### Mail (mail-app)

[root] mail-app: Mail
  [context] session (user="alice", account="work")
  [view] inbox: Inbox (unread=12)  salience=0.95
    [item] thread-42: Launch plan (from="alice@co.org", unread=true)  actions: {reply(body: string), mark_read}
</slop-state>
```

Conventions:

- `<slop-state>` is the default delimiter. Hosts MAY use a different host-specific delimiter only when their model API requires it, but they MUST define that delimiter once and keep it stable across turns. Generic `<state>` is discouraged because it can collide with non-SLOP context.
- The body MAY be the canonical text tree format, JSON, YAML, or another documented projection. The canonical text tree format from [state-tree.md](/spec/core/state-tree#consumer-display-format) is the default because it is compact, human-readable, and already includes paths, properties, summaries, and affordances. JSON is appropriate when the host wants schema-first parsing.
- The body SHOULD be a salience-filtered projection (see [attention.md](/spec/core/attention)), not the raw tree. Hosts SHOULD respect `meta.focus`, salience scores, and view-scoping (see [scaling.md](/spec/extensions/scaling)) to keep the tail small.
- The tail MAY include affordances available on focused nodes so the model can act without a separate query.

## Security model

The state tail is an observation channel, not an instruction channel. Delimiters make the prompt easier to parse, but they are not a security boundary.

Hosts MUST treat all state-tail content as untrusted application data. A node property, document body, chat message, or page title may contain hostile instructions or text that resembles closing tags, tool calls, or higher-priority messages. Hosts SHOULD serialize state with a structured encoder or escape raw text so user-controlled content cannot terminate the `<slop-state>` block or masquerade as host-authored instructions.

The system or developer prompt SHOULD explicitly tell the model that `<slop-state>` contains untrusted live state and must not override system, developer, user, or tool instructions. Providers MUST still re-authorize every `invoke` against live state, caller identity, and resource policy; see [transport.md](/spec/core/transport#security-considerations) and [affordances.md](/spec/core/affordances#applicability-is-not-authorization).

## Placement

Two placements are acceptable:

1. **Trailing user message tail** — append the `<slop-state>` block after the latest user message text, preferably as a separate content block when the model API supports block-structured messages. Simple and works on every chat-completions API. Recommended default.
2. **Synthetic context message** — insert a host-authored message containing only the `<slop-state>` block after the latest stored message and before model generation. Cleaner separation, but only valid when the provider accepts that role and does not reorder it ahead of the cacheable history.

A `<slop-state>` block MUST NOT be placed inside an assistant message or a tool result.

## Prompt caching

This pattern is designed to be cache-friendly for prefix-based prompt caches, but cache APIs differ by provider. Some providers apply caching automatically to exact matching prompt prefixes. Others expose explicit cache controls or checkpoints on structured content blocks. The portable rule is the same in both cases: keep stable instructions, tools, and stored messages before the volatile state tail.

The host SHOULD:

1. Preserve exact serialization and ordering for the stable prefix: system/developer instructions, tool definitions, and stored conversation messages.
2. Render the state tail after that stable prefix.
3. Where explicit cache controls are supported, place the cache control on the last stable block before the state tail.
4. Where caching is automatic, do not invent a synthetic marker; just keep the state tail last and monitor cached-token metrics.

```
turn N:    [system + msgs 1..k]     | cache boundary if supported |  <slop-state-N>
turn N+1:  [system + msgs 1..k+2]   | cache boundary if supported |  <slop-state-N+1>
           ^^^^^^^^^^^^^^^^^^^^^
           identical prefix through msg k can hit cache
```

On turn N+1, the state tail is expected to be uncached. The newly added exchange after message `k` may also be uncached until that request has been processed and becomes part of a future reusable prefix. The benefit is that the long prefix already seen by the model remains reusable instead of being invalidated by fresh app state.

For a typical SLOP projection (a few hundred to a few thousand tokens), paying the uncached cost of the current state tail is acceptable. For very large tails, the host SHOULD apply more aggressive salience filtering, view scoping, windowing, or lazy subtree loading rather than trying to cache live state.

The host SHOULD NOT place explicit cache controls after ordinary live state tails. State changes between most turns, so caching the tail usually produces a low hit rate while consuming cache capacity that could be used elsewhere. If a host intentionally pins a stable snapshot for later temporal reasoning, that snapshot is no longer an ephemeral live-state tail; see [Trade-offs](#trade-offs).

## Trade-offs

The ephemeral-tail pattern is optimized for **present-tense** reasoning: the model acts on what is true *now*. It is intentionally weaker for **temporal** reasoning — the model cannot answer "what was selected when I asked you that earlier?" because past states are not retained.

Hosts that need temporal reasoning have two options:

- **Inline diffs** — when state changes meaningfully between turns, summarize the delta as a short note in the assistant or tool-result message. The tail still carries the full current state; history carries a compact change log. This costs some tokens but preserves cacheability of the message prefix.
- **Snapshot pinning** — on explicit user reference ("remember this state"), serialize a snapshot into the next assistant message. Use sparingly; each pinned snapshot is a permanent token cost.

Most agent workloads do not need either. Default to the pure ephemeral tail and add temporal mechanisms only when a concrete use case demands them.

## Interaction with patches

SLOP providers stream JSON Patch updates between snapshots (see [messages.md](/spec/core/messages)). A consumer driving an LLM SHOULD NOT forward raw patches into the model context. Patches are an optimization for the consumer's local tree mirror; the model only ever sees the materialized current state in the `<slop-state>` tail.

Exception: if the host is running an autonomous loop where the model decides when to re-observe, the host MAY surface a compact "state changed" signal (without the patch body) so the model knows a new tail will be available on the next turn.

## Minimum host responsibilities

A consumer that claims to support this integration:

1. MUST maintain the conversation history free of state-tail blocks across turns.
2. MUST render the current SLOP tree projection into a state tail on every model request, using `<slop-state>` unless the host documents another stable delimiter.
3. MUST treat the state tail as untrusted observation data, not instructions, and SHOULD escape or encode user-controlled text so it cannot forge delimiters or host-authored messages.
4. MUST keep the state tail after the stored conversation prefix so live state does not invalidate reusable prompt-cache prefixes.
5. SHOULD place explicit prompt-cache controls at the boundary between stored history and the state tail where the provider supports them.
6. SHOULD apply salience and view-scope filtering before rendering the tail.
7. SHOULD document which delimiter and body format it emits (canonical text tree / JSON / Markdown / custom) so prompt authors can rely on a stable shape.
