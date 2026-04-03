---
title: "Benchmarks: MCP vs SLOP"
---
SLOP and MCP solve different problems with different architectures. MCP is **action-first** — it exposes a flat registry of tools that an AI agent can call. SLOP is **state-first** — it exposes a semantic state tree with contextual affordances that change based on the application's current state.

This page presents benchmark results from running identical tasks against both protocols using the same backing application (an issue tracker with repos, issues, comments, and labels). The benchmark is open source and reproducible — see [`benchmarks/mcp-vs-slop`](https://github.com/devteapot/slop/tree/main/benchmarks/mcp-vs-slop) in the repository.

## Important context

These protocols have **different design goals**:

- **MCP** is designed for tool integration — connecting AI agents to external capabilities (databases, APIs, file systems). It excels at making tools available.
- **SLOP** is designed for state observation — giving AI agents structured awareness of application state with contextual actions. It excels at providing context for decision-making.

The benchmark measures how each approach performs when an AI agent needs to **understand state and act on it** — a use case where SLOP's design has a natural advantage. Tasks that are purely tool-execution ("call this API with these parameters") would favor MCP's simpler model.

## Setup

**Application:** An issue tracker with 3 repositories, 15 issues (mix of open/closed), 13 comments, and labels. A larger dataset (10 repos, ~100 issues) is used for scale tests.

**Protocols compared:**
- **MCP** — 13 flat tools (`list_repos`, `get_issue`, `close_issue`, etc.) via stdio transport
- **SLOP** — Full state tree with all nodes and contextual affordances
- **SLOP (opt)** — Optimized state tree with salience scoring, lazy comments, and summaries, plus navigation tools (`slop_query`, `slop_get_state`)
- **SLOP (basic)** — Full state tree with a minimal system prompt (no SLOP spec concepts explained)

**Model:** Gemini 2.5 Flash. Additional runs with Gemini 2.5 Pro and Gemini 3 Flash are noted where results differ significantly.

## Correctness

Each scenario has a verification function that checks the application state after the agent finishes. Results are pass/fail with detailed check breakdowns.

| Scenario | MCP | SLOP | SLOP (opt) | SLOP (basic) |
|---|---|---|---|---|
| explore-and-act | PASS | PASS | PASS | PASS |
| triage | PASS | PASS | PASS | PASS |
| bulk-update | PASS | PASS | PASS | PASS |
| scale-triage (100 issues) | **FAIL** | PASS | PASS | PASS |
| negative (impossible actions) | **FAIL** | PASS | PASS | PASS |
| contextual (multi-turn) | PASS | PASS | PASS | PASS |
| recovery (fail then act) | PASS | PASS | PASS | PASS |
| state-transitions (close/reopen) | PASS | PASS | PASS | PASS |
| cross-entity (correlate data) | PASS | PASS | PASS | PASS |
| conditional (rule-based) | PASS | PASS | PASS | PASS |
| ambiguity (vague references) | **FAIL** | PASS | PASS* | PASS |
| complex-workflow (sprint planning) | **FAIL** | PASS | PASS | PASS |
| **Total** | **8/12** | **12/12** | **11/12*** | **12/12** |

*SLOP (opt) ambiguity failure was LLM variance (0 tool calls on one run), not a structural issue. Across multiple runs it passes consistently.

### Why MCP fails

**scale-triage (FAIL 10/20):** With 10 repos, the agent needs `list_repos` + 10 `list_issues` calls just for discovery, consuming its action budget before it can act on all bugs. MCP's discovery overhead scales linearly with the number of entities.

**negative (FAIL 4/5):** The prompt asks to assign a closed issue. MCP's flat tool list always shows `assign_issue` regardless of issue state — the tool doesn't validate, and the agent doesn't know the action is inappropriate. SLOP's contextual affordances don't expose `assign` on closed issues, so the agent never attempts it.

**complex-workflow (FAIL 8/9):** The task requires computing "who has the fewest assignments across ALL repos." MCP would need to list issues for every repo, track all assignees, compare counts, then act. The agent assigned to the wrong person (charlie instead of alice) because it couldn't aggregate state across multiple tool-call results.

### Why SLOP succeeds

SLOP provides the full application state upfront. The agent can:
- Count unassigned bugs across all repos without any tool calls
- See that a closed issue has `reopen` but not `assign` — preventing invalid actions
- Compare assignee load across the entire tree before making a decision
- Act on all matching issues in a single LLM turn

## Performance

### Scenario highlights

**Triage (assign unassigned bugs across 3 repos):**

| Metric | MCP | SLOP (opt) | Delta |
|---|---|---|---|
| Tool calls | 16 | 12 | -25% |
| LLM round trips | 8 | 2 | -75% |
| Wall time | 12,404ms | 4,605ms | -63% |
| Cost | $0.0049 | $0.0049 | 0% |

SLOP batches all 12 actions (6 assign + 6 label) in a single LLM turn. MCP needs 8 turns: discovery calls interleaved with actions.

**Scale-triage (100 issues across 10 repos):**

| Metric | MCP | SLOP (opt) | Delta |
|---|---|---|---|
| Tool calls | 20 | 32 | +60% |
| LLM round trips | 21 | 2 | -90% |
| Wall time | 25,633ms | 19,737ms | -23% |
| Correctness | 10/20 | 20/20 | +50% |

MCP uses fewer tool calls but needs 21 LLM round trips and still only gets half the bugs. SLOP uses more tool calls (all the assign+label actions) but batches them in 2 turns with 100% correctness.

**Complex workflow (sprint planning — aggregate, prioritize, assign, comment, clean up):**

| Metric | MCP | SLOP (basic) | Delta |
|---|---|---|---|
| Tool calls | 17 | 7 | -59% |
| LLM round trips | 18 | 5 | -72% |
| Wall time | 20,800ms | 11,884ms | -43% |
| Cost | $0.0161 | $0.0121 | -25% |
| Correctness | FAIL | PASS | — |

The most complex scenario is also SLOP's strongest showing — cheaper, faster, and correct where MCP failed.

### Cost tradeoff

SLOP's state tree consumes more input tokens than MCP's system prompt. For simple tasks, this makes SLOP more expensive:

| Scenario type | MCP cost | SLOP (opt) cost | Verdict |
|---|---|---|---|
| Simple lookup/action | Lower | Higher | MCP cheaper |
| Multi-step within one repo | Similar | Similar | Comparable |
| Multi-repo reasoning | Lower per call, but more calls | Higher upfront, fewer calls | Depends on complexity |
| Aggregate/cross-entity | Fails or expensive | Front-loaded but correct | SLOP wins on value |

The cost calculation changes when you factor in correctness. A failed agent run that costs $0.01 is more expensive than a successful run that costs $0.02 — you have to re-run or manually intervene.

## Contextual affordances

One of SLOP's most impactful features is that affordances change based on state. This was tested directly:

**Negative scenario:** "Close an already-closed issue, assign a closed issue, delete a repo."

- **MCP:** `assign_issue` and `close_issue` are always in the tool list. The agent called `assign_issue` on a closed issue — the tool succeeded, corrupting state. No protocol-level guard.
- **SLOP:** Closed issues expose `reopen` and `comment` but not `assign`, `close`, `add_label`, or `remove_label`. The agent saw no matching action and correctly refused: *"I cannot assign issue-9 because the available actions are comment and reopen."*

This is **correctness by design** — the protocol prevents structurally invalid actions without relying on the LLM's judgment.

## System prompt impact

We compared SLOP with two system prompts:

- **SLOP (full prompt):** Explains SLOP concepts — node types, affordances, meta fields, optimized views (windowed collections, lazy children, stub nodes)
- **SLOP (basic prompt):** Just "Here is the current state. Use the tools to complete the task."

| Metric | SLOP (full prompt) | SLOP (basic prompt) |
|---|---|---|
| Correctness | 12/12 | 12/12 |
| Avg cost | Higher (larger prompt) | Lower |
| Avg time | Similar | Often faster |

The SLOP system prompt with spec concepts didn't improve correctness on any scenario. The tree format with `formatTree()` — showing node types, properties, affordances, summaries, and windowing indicators — is self-explanatory enough for the model.

The spec prompt becomes more valuable with optimized trees, where the agent needs to understand when to use `slop_query` to expand truncated data. For the full tree, the basic prompt is sufficient and cheaper.

## Cross-model comparison

We ran the benchmark across three Gemini models to test whether model capability changes the protocol advantage:

| Finding | Detail |
|---|---|
| Smarter models help MCP | Gemini 2.5 Pro dropped MCP's triage round trips from 11 to 8 by batching tool calls better |
| Smarter models help SLOP more | SLOP naive went from 10/11 to 11/11 with Gemini 2.5 Pro — better at processing the full tree |
| Very smart models can hurt SLOP (opt) | Gemini 3 Flash over-queried with `slop_query`, burning tokens unnecessarily |
| MCP's structural failures persist | Even the best model can't fix scale-triage (discovery budget) or negative (flat tool list) |

The key insight: **model intelligence narrows the performance gap but doesn't eliminate SLOP's structural advantages** in correctness and contextual safety.

## Scaling considerations

The spec defines optimization patterns that reduce tree size for large applications:

| Optimization | Effect | When to use |
|---|---|---|
| Salience scoring | Low-priority nodes compacted first by `maxNodes` | Large collections with mixed relevance |
| Lazy children | Children declared but not inlined (summary only) | Comments, attachments, nested detail |
| Summaries | Natural-language description of truncated content | All optimized nodes |
| `slop_query` | Agent can expand any path on demand | When agent needs detail beyond the default view |

In our benchmark, the optimized tree reduced the small dataset from 22KB to 18KB and the large dataset from 154KB to 81KB while maintaining full correctness.

See [Scaling](/spec/extensions/scaling) for the full optimization guide, including a discussion of [affordance visibility on stub nodes](/spec/extensions/scaling#considerations-and-limitations).

## Reproducing the benchmark

```bash
cd benchmarks/mcp-vs-slop
bun install

# Scripted mode (no LLM, measures protocol overhead)
bun run run.ts --mode scripted

# Agent mode (requires Gemini API key)
GEMINI_API_KEY=xxx bun run run.ts --mode agent --model gemini-2.5-flash

# Specific scenarios
bun run run.ts --mode agent --scenario triage,negative,complex-workflow

# Specific protocols
bun run run.ts --mode agent --protocol slop,slop-optimized

# Verbose logging (shows every tool call and LLM turn)
bun run run.ts --mode agent --scenario complex-workflow --verbose

# Higher iterations for statistical confidence
bun run run.ts --mode agent --iterations 10
```

## Conclusions

1. **SLOP's state-first approach eliminates discovery overhead.** MCP agents spend significant time and tokens listing, querying, and assembling state before they can act. SLOP front-loads this context.

2. **Contextual affordances prevent invalid actions.** This is not just an optimization — it's a safety feature. MCP cannot prevent an agent from calling `assign_issue` on a closed issue. SLOP can.

3. **The cost tradeoff is real but nuanced.** SLOP uses more input tokens due to the state tree. For simple tasks, this is overhead. For complex tasks requiring reasoning across entities, SLOP's upfront cost is offset by fewer LLM round trips and higher correctness.

4. **The protocols serve different purposes.** MCP is excellent for exposing discrete tools (database queries, API calls, file operations). SLOP is excellent for applications where the AI needs to understand and reason about state before acting. Many real-world systems would benefit from both: MCP for external integrations, SLOP for application state awareness.

5. **Protocol-level optimization works.** Salience scoring, lazy children, and summaries reduce tree size without losing correctness — but the agent needs navigation tools (`slop_query`) to access truncated data when needed.
