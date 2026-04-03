# MCP vs SLOP Benchmark

A head-to-head benchmark comparing [MCP](https://modelcontextprotocol.io) (Model Context Protocol) and [SLOP](https://slopai.dev) (State Layer for Observable Programs) using an identical backing application.

Both protocols expose the same issue tracker (repos, issues, comments, labels) with the same capabilities. The benchmark measures correctness, performance, token usage, and cost when an LLM agent performs identical tasks through each protocol.

For full results and analysis, see the [benchmark documentation](https://docs.slopai.dev/guides-advanced/benchmarks/).

## Architecture

```
benchmarks/mcp-vs-slop/
├── app/
│   ├── store.ts              # In-memory issue tracker (shared backing state)
│   ├── seed.ts               # Deterministic seed data (small: 15 issues, large: ~100 issues)
│   ├── slop-server.ts        # SLOP protocol layer (state tree + contextual affordances)
│   └── mcp-server.ts         # MCP protocol layer (13 flat tools via stdio)
├── harness/
│   ├── types.ts              # Metric types, pricing data
│   ├── metrics.ts            # Byte counting, timing, message tracking
│   ├── scripted-runner.ts    # Deterministic scenario runner (no LLM)
│   ├── agent-runner.ts       # LLM agent runner (Gemini)
│   ├── reporter.ts           # Markdown + JSON output
│   ├── logger.ts             # Verbose logging
│   └── slop-system-prompt.ts # Domain-agnostic SLOP agent prompt
├── scenarios/
│   ├── explore-and-act.ts    # Find issue, comment, label
│   ├── triage.ts             # Assign unassigned bugs across repos
│   ├── bulk-update.ts        # Close all wontfix issues
│   ├── scale-triage.ts       # Triage across 10 repos, ~100 issues
│   ├── negative.ts           # Attempt impossible actions
│   ├── contextual.ts         # Multi-turn: create then refer by context
│   ├── recovery.ts           # Fail on impossible, then succeed on valid
│   ├── state-transitions.ts  # Close, reopen, verify affordances change
│   ├── cross-entity.ts       # Correlate data across repos
│   ├── conditional.ts        # Apply rules based on state
│   ├── ambiguity.ts          # Resolve vague references
│   └── complex-workflow.ts   # Sprint planning: aggregate, prioritize, assign, comment, clean up
├── results/                  # Generated output (gitignored)
└── run.ts                    # CLI entry point
```

## How it works

### One app, two protocols

A single `IssueTrackerStore` backs both servers. The SLOP server exposes a state tree where each issue is a node with contextual affordances (e.g., open issues have `close`, `assign`, `add_label`; closed issues have `reopen`, `comment`). The MCP server exposes 13 flat tools (`list_repos`, `get_issue`, `close_issue`, etc.) that always appear regardless of state.

### Four protocol variants

| Variant | Protocol | Tree | System prompt |
|---|---|---|---|
| **MCP** | MCP (flat tools, stdio) | No state tree | Domain-specific |
| **SLOP** | SLOP (full tree, WebSocket) | All nodes, all children | SLOP spec concepts |
| **SLOP (opt)** | SLOP (optimized tree) | Salience scoring, lazy comments, summaries | SLOP spec concepts |
| **SLOP (basic)** | SLOP (full tree) | All nodes, all children | Minimal (no spec concepts) |

### Scripted mode

Runs deterministic operation sequences against both protocols without an LLM. Measures protocol-level overhead: bytes on the wire, message count, setup time, round-trip latency.

### Agent mode

Runs an LLM (Gemini) through identical task prompts using each protocol. The LLM receives tools (MCP's flat list or SLOP's affordance-derived tools) and acts autonomously. Measures:

- **Correctness** — verification functions check the store state after the agent finishes
- **Tool calls** — number of tool invocations
- **LLM round trips** — number of model API calls
- **Tokens** — input and output token counts from the model's usage metadata
- **Cost** — estimated USD based on model pricing
- **Time** — wall-clock duration

### Verification

Each scenario includes a `verify(store)` function that inspects the final store state. Checks include:
- Did the agent modify the correct entities?
- Did it avoid modifying entities it shouldn't have?
- Did it follow the task rules (e.g., only assign *unassigned* bugs)?

Results are reported as PASS/FAIL with detailed check breakdowns and failure reasons.

## Usage

```bash
# Install dependencies
bun install

# Scripted mode — no LLM, measures protocol overhead
bun run run.ts --mode scripted

# Agent mode — requires a Gemini API key
GEMINI_API_KEY=xxx bun run run.ts --mode agent

# Choose a model
bun run run.ts --mode agent --model gemini-2.5-pro

# Run specific scenarios (comma-separated)
bun run run.ts --mode agent --scenario triage,negative,complex-workflow

# Run specific protocols (comma-separated)
bun run run.ts --mode agent --protocol slop,slop-optimized

# Verbose logging — shows every tool call, LLM turn, and verification check
bun run run.ts --mode agent --scenario state-transitions --verbose

# Multiple iterations for statistical confidence
bun run run.ts --mode agent --iterations 10

# Combine flags
GEMINI_API_KEY=xxx bun run run.ts \
  --mode agent \
  --model gemini-2.5-flash \
  --scenario complex-workflow \
  --protocol mcp,slop-optimized \
  --iterations 5 \
  --verbose
```

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--mode` | `scripted` | `scripted`, `agent`, or `all` |
| `--model` | `gemini-2.5-flash` | Gemini model ID |
| `--scenario` | `all` | Comma-separated scenario names |
| `--protocol` | `all` | Comma-separated: `mcp`, `slop`, `slop-optimized`, `slop-basic` |
| `--iterations` | `3` | Number of runs per protocol (results averaged) |
| `--verbose` | `false` | Show detailed tool call and verification logs |

### Output

Results are written to:
- `results/latest.md` — markdown report with tables
- `results/latest.json` — raw data
- stdout — same markdown report

## Scenarios

### Performance scenarios

| Scenario | Description | What it tests |
|---|---|---|
| `explore-and-act` | Find an issue by description, comment, label | Discovery cost |
| `triage` | Assign all unassigned bugs across 3 repos | Multi-repo batch actions |
| `bulk-update` | Close all wontfix issues | Filtered batch operations |
| `scale-triage` | Triage across 10 repos, ~100 issues | Scaling behavior |

### Correctness scenarios

| Scenario | Description | What it tests |
|---|---|---|
| `negative` | Attempt impossible actions (close closed issue, delete repo) | Affordance safety |
| `contextual` | Create issue, then refer to it by context in follow-up actions | Multi-turn state tracking |
| `recovery` | Fail on impossible action, then succeed on valid one | Graceful degradation |
| `state-transitions` | Close, verify, reopen, comment, close another, label | Affordance changes across state transitions |
| `cross-entity` | Read comments on one issue to act on another | Cross-entity reasoning |
| `conditional` | Apply different rules based on comment count and labels | State-dependent decision making |
| `ambiguity` | Resolve vague descriptions to specific issues | Disambiguation from state context |
| `complex-workflow` | Sprint planning: find busiest repo, pick top bugs, assign to least-loaded person, summarize, label, clean up | End-to-end multi-step reasoning |

## Adding scenarios

Create a new file in `scenarios/`:

```typescript
import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

export const myScenario: Scenario = {
  name: "my-scenario",
  description: "What this scenario tests",
  agentPrompt: "The task prompt sent to the LLM",

  // Scripted steps (optional, for protocol-level benchmarks)
  steps: [
    {
      name: "step_name",
      async slop(consumer, subId, snapshot) { /* SLOP actions */ },
      async mcp(client) { /* MCP tool calls */ },
    },
  ],

  // Verification (optional, for agent mode)
  verify(store: IssueTrackerStore): VerificationResult {
    const checks = [
      {
        name: "Check description",
        passed: /* boolean */,
        detail: /* optional string */,
      },
    ];
    return { passed: checks.every((c) => c.passed), checks };
  },
};
```

Then add it to `run.ts`:

```typescript
import { myScenario } from "./scenarios/my-scenario";
// Add to allScenarios array
```
