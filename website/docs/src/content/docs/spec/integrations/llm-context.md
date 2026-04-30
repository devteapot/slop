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
- `generated_at`, when present, MUST be an ISO 8601 / RFC 3339 timestamp. Hosts SHOULD emit UTC timestamps with a `Z` suffix.
- The body MAY be the canonical text tree format, JSON, YAML, or another documented projection. The canonical text tree format from [state-tree.md](/spec/core/state-tree#consumer-display-format) is the default because it is compact, human-readable, and already includes paths, properties, summaries, and affordances. JSON is appropriate when the host wants schema-first parsing.
- The body SHOULD be a salience-filtered projection (see [attention.md](/spec/core/attention)), not the raw tree. Hosts SHOULD respect `meta.focus`, salience scores, and view-scoping (see [scaling.md](/spec/extensions/scaling)) to keep the tail small.
- When the tail includes multiple providers or apps, the body MUST preserve clear per-provider or per-app boundaries with a stable human-readable name and provider/app ID. Text projections SHOULD use one section per provider or app, as in `### Mail (mail-app)`.
- Disconnected providers MUST NOT leave stale tree content in `<slop-state>` as if it were current. Hosts SHOULD either omit disconnected providers from live state or include only a clearly labeled disconnected/status-only entry, optionally with a last-observed timestamp.
- The tail MAY include affordances available on focused nodes so the model can act without a separate query.

## Related SLOP context blocks

Hosts sometimes need to surface SLOP-related context that is not live state. For example, a local host may know that several SLOP-enabled applications are discoverable but not connected yet. That catalog is useful to the model, but it is not a current tree observation and MUST NOT be mixed into `<slop-state>`.

Hosts that expose available-but-unconnected applications SHOULD use a sibling block:

```
<slop-apps-available generated_at="2026-04-28T10:30:00Z">
- Mail (id: `mail-app`, websocket, local)
- Calendar (id: `calendar-app`, unix, local)
</slop-apps-available>
```

`<slop-apps-available>` is host catalog context, not a replacement for the live state tail. It SHOULD follow the same lifecycle as the state tail: render it fresh at request time, place it after the stored conversation prefix, and never persist it into conversation history. Hosts MAY omit this block entirely when tool calls such as `list_apps` provide the same catalog.

## Security model

The state tail is an observation channel, not an instruction channel. Delimiters make the prompt easier to parse, but they are not a security boundary.

Hosts MUST treat all state-tail content as untrusted application data. A node property, document body, chat message, or page title may contain hostile instructions or text that resembles opening tags, closing tags, tool calls, or higher-priority messages. Hosts MUST serialize state with a structured encoder, use a format-independent encoding layer, or escape raw text so user-controlled content cannot terminate the `<slop-state>` block, fake a new SLOP context block, or masquerade as host-authored instructions.

For text tag blocks, hosts MUST neutralize any app-controlled text that resembles a SLOP context tag — both opening and closing — before final block assembly. Both directions matter: a fake closing tag can terminate the wrapping block, and a fake opening tag can let hostile content masquerade as a fresh, host-authored SLOP block in models that are lenient about nesting. At minimum, apply case-insensitive substitutions that tolerate whitespace and attribute-like text:

| Match (case-insensitive) | Replacement |
|---|---|
| `<\s*slop-state\b[^>]*>` | `<slop-state-escaped>` |
| `<\s*/\s*slop-state\b[^>]*>` | `<\/slop-state>` |
| `<\s*slop-apps-available\b[^>]*>` | `<slop-apps-available-escaped>` |
| `<\s*/\s*slop-apps-available\b[^>]*>` | `<\/slop-apps-available>` |

Apply the substitutions to every piece of app-controlled text rendered inside a SLOP context block: provider names, app IDs, tree text, properties, summaries, labels, affordance descriptions, and available-app metadata.

The system or developer prompt SHOULD explicitly tell the model that `<slop-state>` contains untrusted live state and must not override system, developer, user, or tool instructions. Providers MUST still re-authorize every `invoke` against live state, caller identity, and resource policy; see [transport.md](/spec/core/transport#security-considerations) and [affordances.md](/spec/core/affordances#applicability-is-not-authorization).

## Placement

Two provider-compatible placements are acceptable. Hosts SHOULD choose based on the target API's message model and cache controls:

1. **Trailing user message tail** — append the `<slop-state>` block after the latest user message text, preferably as a separate content block when the model API supports block-structured messages. This is the recommended default for chat-completions APIs without explicit cache controls or APIs that cannot represent a separate host-authored context message.
2. **Synthetic context message** — insert a host-authored message containing only the `<slop-state>` block after the latest stored message and before model generation. This is the recommended default for APIs with explicit cache controls or checkpoints, because the cache marker can sit on the last stable block before the state and the volatile state can live in its own post-boundary message. This placement is only valid when the provider accepts that role and the SDK/provider does not reorder or merge it ahead of the cacheable history.

A `<slop-state>` block MUST NOT be placed inside an assistant message or a tool result.

Some host APIs only expose a "prepend context" hook that runs before the stored prefix rather than after it. Such hosts MAY still emit the state tail through the prepend hook, but they MUST treat this as a known prompt-cache regression: the volatile state will appear ahead of stable history and invalidate prefix caches on every turn. Hosts in this category SHOULD document the limitation in their integration README and SHOULD push for an append-style hook upstream so the placement can move to a cache-friendly position.

## Prompt caching

This pattern is designed to be cache-friendly for prefix-based prompt caches, but cache APIs differ by provider. Some providers apply caching automatically to exact matching prompt prefixes. Others expose explicit cache controls or checkpoints on structured content blocks. The portable rule is the same in both cases: keep stable instructions, tools, and stored messages before the volatile state tail.

The host SHOULD:

1. Preserve exact serialization and ordering for the stable prefix: system/developer instructions, tool definitions, and stored conversation messages.
2. Render the state tail after that stable prefix.
3. Where explicit cache controls are supported, place the cache control on the last stable block before the state tail.
4. Where caching is automatic, do not invent a synthetic marker; just keep the state tail last and monitor cached-token metrics.

```
turn N:    [system + tools + msgs 1..k]     | cache boundary if supported |  <slop-state-N>
turn N+1:  [system + tools + msgs 1..k+2]   | cache boundary if supported |  <slop-state-N+1>
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
           identical prefix through msg k can hit cache
```

On turn N+1, the state tail is expected to be uncached. The newly added exchange after message `k` may also be uncached until that request has been processed and becomes part of a future reusable prefix. The benefit is that the long prefix already seen by the model remains reusable instead of being invalidated by fresh app state.

For a typical SLOP projection (a few hundred to a few thousand tokens), paying the uncached cost of the current state tail is acceptable. For very large tails, the host SHOULD apply more aggressive salience filtering, view scoping, windowing, or lazy subtree loading rather than trying to cache live state.

The host SHOULD NOT place explicit cache controls after ordinary live state tails. State changes between most turns, so caching the tail usually produces a low hit rate while consuming cache capacity that could be used elsewhere. If a host intentionally pins a stable snapshot for later temporal reasoning, that snapshot is no longer an ephemeral live-state tail; see [Trade-offs](#trade-offs).

### Provider compatibility

The pattern itself — clean history plus an ephemeral tail — requires no provider-specific features. Only the cache-integration step varies, and it degrades gracefully when caching is unavailable. Hosts SHOULD classify each target model and endpoint by its actual cache API and act accordingly. Vendor behavior changes over time and can vary by model, deployment type, region, and transport facade.

- **Automatic prefix caching** (for example, OpenAI automatic prompt caching, DeepSeek context caching, Fireworks prompt caching, Gemini implicit caching, DashScope/Qwen implicit caching, and caching on supported Groq or Together endpoints). Caching is implicit on exact matching prompt prefixes. The host SHOULD keep the prefix stable: stable system-prompt serialization, stable tool ordering, no timestamps or randomized IDs in stored messages, and consistent cache-routing hints where the provider offers them (for example session affinity, cache keys, isolation keys, or retention settings). The state tail naturally remains outside the reusable prefix.
- **Explicit block markers** (for example, Anthropic `cache_control`, Amazon Bedrock `cachePoint`, and DashScope/Qwen explicit `cache_control`). The host places the marker on the last stable content block before the state tail, as described above. For Anthropic-style block-level `cache_control`, a separate final state message or content block is usually cleaner than appending state to the same block as the latest user text, because the cache marker must remain on stable content before the volatile state. Providers in this category often impose minimum-token thresholds, maximum marker counts, block-lookback limits, or TTLs; below the threshold the host SHOULD fall back to whatever implicit caching the provider offers, not invent a synthetic marker.
- **Named cached resources** (for example, Google Gemini `CachedContent`). The host creates a separate cached resource for stable, reusable material such as system instructions, large documents, or tool schemas, then references that resource when sending the live request with the `<slop-state>` tail as ordinary uncached request content. This is not the same as placing a marker immediately before the tail.
- **No prefix caching** (e.g. some smaller hosted endpoints, certain fine-tuning runtimes). The freshness and history-hygiene properties of the pattern still hold; the host simply pays full input tokens every turn. No host action is required beyond keeping the state tail last so a future caching upgrade is automatically beneficial.
- **Local or self-hosted runtimes** (for example, vLLM automatic prefix caching, SGLang radix caching, llama.cpp prompt caches, Ollama, TGI, or custom serving stacks). Cache behavior depends on runtime flags, server mode, batching, session reuse, and eviction policy. The host controls serialization end-to-end, so exact-prefix stability is achievable, but it SHOULD verify cache reuse in the chosen runtime rather than assuming every deployment reuses prefixes automatically.

The `<slop-state>` framing is plain text and works on any model, but tag-following quality varies. Frontier models respect explicit delimiters reliably; smaller open-weight models occasionally leak the tag into output or treat tail content as instructions. Hosts targeting weaker models SHOULD strengthen the system prompt's description of the tag contract and SHOULD NOT relax the security guidance in [Security model](#security-model) — provider capability does not change the trust level of state-tail content.

## Trade-offs

The ephemeral-tail pattern is optimized for **present-tense** reasoning: the model acts on what is true *now*. It is intentionally weaker for **temporal** reasoning — the model cannot answer "what was selected when I asked you that earlier?" because past states are not retained.

Hosts that need temporal reasoning have two options:

- **Inline diffs** — when state changes meaningfully between turns, persist a compact host-authored delta note in an assistant or tool-result message, such as `State change: Mail unread 12 -> 13; focused thread thread-42 -> thread-91`. The tail still carries the full current state; history carries a compact change log. This costs some tokens but preserves cacheability of the message prefix.
- **Snapshot pinning** — on explicit user reference ("remember this state"), serialize a snapshot into the next assistant message. Use sparingly; each pinned snapshot is a permanent token cost.

Most agent workloads do not need either. Default to the pure ephemeral tail and add temporal mechanisms only when a concrete use case demands them.

## Interaction with patches

SLOP providers stream JSON Patch updates between snapshots (see [messages.md](/spec/core/messages)). A consumer driving an LLM SHOULD NOT forward raw patches into the model context. Patches are an optimization for the consumer's local tree mirror; the model only ever sees the materialized current state in the `<slop-state>` tail.

Exception: if the host is running an autonomous loop where the model decides when to re-observe, the host MAY surface a compact "state changed" signal (without the patch body) so the model knows a new tail will be available on the next turn.

## Minimum host responsibilities

A consumer that claims to support this integration:

1. MUST maintain the conversation history free of state-tail blocks across turns.
2. MUST render the current SLOP tree projection into a state tail on every model request, using `<slop-state>` unless the host documents another stable delimiter. Hosts that inject indirectly (for example, by reading a file written by a separate bridge process) MAY operate within a bounded freshness window instead of literally re-rendering on each request, but they MUST document that window in their integration README and MUST drop the injection if the bridge appears stalled or dead so the model never sees state that may be silently outdated.
3. MUST treat the state tail as untrusted observation data, not instructions, and MUST escape or encode user-controlled text in any text-based delimiter format so it cannot forge SLOP context tags or masquerade as host-authored messages. The case-insensitive substitution rules in [Security model](#security-model) are the minimum bar.
4. MUST keep the state tail after the stored conversation prefix so live state does not invalidate reusable prompt-cache prefixes — except where the host's surrounding API only exposes a prepend hook, in which case the host MUST follow the prepend-only exception in [Placement](#placement) and document it as a known cache regression.
5. SHOULD place explicit prompt-cache controls at the boundary between stored history and the state tail where the provider supports them.
6. SHOULD apply salience and view-scope filtering before rendering the tail.
7. MUST preserve clear provider/app boundaries when rendering multiple connected providers or apps.
8. MUST NOT present stale disconnected-provider trees as current state.
9. SHOULD keep non-state SLOP catalog context, such as available unconnected apps, outside `<slop-state>` and use a sibling block or tool result instead.
10. SHOULD document which delimiter and body format it emits (canonical text tree / JSON / Markdown / custom) so prompt authors can rely on a stable shape.
