# SLOP: A Protocol for API-Style Communication Between Autonomous AI Agents

**Diego Carlino**$^{1}$

$^{1}$Independent Researcher, diego@devteapot.com

## Abstract

As autonomous AI agents gain the ability to interact with software systems, the interface between agents and applications becomes a critical design concern. Current approaches—tool/function-calling APIs and vision-based observation—present a false dichotomy: agents either act blindly with a flat tool registry, or observe lossily through pixel-level screenshots. We present SLOP (State Layer for Observable Programs), a protocol that exposes a structured, semantic state tree from applications to AI consumers, enabling agents to perceive application state directly before acting. SLOP provides a rich, queryable state model with contextual affordances, incremental update semantics, attention-aware subscriptions, and progressive disclosure. Through formal specification and empirical benchmarking, we show that SLOP reduces LLM round-trip counts by 75–90% compared to MCP-style tool-calling on multi-step tasks, while achieving higher correctness on complex, stateful coordination scenarios. We frame SLOP as an "agent-native API" and derive design principles that may inform the broader community studying how to best expose software capabilities to autonomous AI agents.

**Keywords:** multi-agent systems, API design, AI agent communication, protocol specification, state management, autonomous agents

## 1 Introduction

Autonomous AI agents that interact with software systems face a fundamental challenge: how to perceive the state of the applications they act upon. Today, two dominant paradigms exist:

**Tool-based interaction** (e.g., OpenAI function calling, the Model Context Protocol) exposes a flat list of callable functions. The agent invokes tools without visibility into the application's current state, requiring dedicated read-only tools for every observable fact. This approach scales poorly—rich applications require hundreds of read-only tools just to reconstruct state.

**Vision-based observation** (screenshots analyzed by vision models) provides rich perceptual input but is expensive (token-per-pixel costs), lossy (OCR errors, layout ambiguity), and slow (round-trip per observation).

Both paradigms exist because there is no standard way for an application to declare: *"here is what I am right now."*

We present **SLOP** (State Layer for Observable Programs), a protocol for applications to expose their semantic state to external observers—primarily AI agents. An application implementing SLOP publishes a **state tree**: a hierarchical, typed representation of what it currently is and what can be done with it. An AI consumer connects, subscribes to the parts it cares about, and receives a stream of incremental updates.

The key properties of SLOP are:

- **Semantic, not visual.** The state tree describes meaning, not layout or pixels.
- **Push, not pull.** Subscribed agents receive incremental patches as state changes, eliminating polling.
- **Progressive.** Agents control query depth and apply salience filters to respect their token budget.
- **Actionable.** Actions (affordances) live on the state nodes they affect, appearing in context rather than in a disconnected global registry.

This paper makes the following contributions:

1. We formalize the SLOP protocol specification, including message formats, state tree semantics, affordance model, and transport layer.
2. We situate SLOP within the broader landscape of agent communication protocols, identifying the gap it fills for autonomous agent-to-agent and agent-application communication.
3. We present empirical results from a head-to-head benchmark against the Model Context Protocol, showing significant improvements in correctness, efficiency, and stateful reasoning.
4. We derive design principles for "agent-native APIs"—APIs designed specifically for the unique constraints and capabilities of AI agents.

## 2 Motivation: The Gap in Autonomous Agent Coordination

### 2.1 The Current State of Agent Communication

The landscape of AI agent communication has evolved rapidly. Several major approaches exist:

**Function calling and tool use** (OpenAI, Anthropic, Google) has become the de facto standard for single-agent tool invocation. An LLM receives a schema describing available functions and decides which to call with what arguments. This works well for simple, stateless actions but breaks down when agents need to understand the application's current state to make informed decisions.

**The Model Context Protocol (MCP)** [Anthropic 2024] standardizes how LLMs discover and interact with external tools and data sources. MCP defines a flat registry of tools with descriptions, parameter schemas, and optional resource schemas. While a significant step toward interoperability, MCP's flat tool model suffers from the same core limitation: tools are disconnected from state. A tool like `close_issue` appears in the registry regardless of whether the issue is already closed, already assigned, or already deleted.

**Agent-to-agent protocols** (AutoGen, CrewAI, Multi-Agent Collaboration frameworks) typically rely on message-passing with natural language payloads. Agents communicate about what they have observed and what they plan to do, but without a shared state model, each agent must independently discover and interpret the state of shared resources.

**Accessibility APIs and browser automation** (ARIA, Playwright, Puppeteer) provide structured access to application state for screen readers and testing frameworks. SLOP shares the observation capability with these systems but is explicitly designed for the AI agent's context window constraints and tool-use workflow.

### 2.2 The Problem for Autonomous Agents

Autonomous agents have properties that distinguish them from traditional API consumers:

1. **Finite context window.** Agents have a bounded amount of information they can process at once. They cannot dump an entire application's state into their prompt.
2. **Non-deterministic reasoning.** Agents may make incorrect observations or take invalid actions. Protocols should make the safe path obvious and the unsafe path discoverable.
3. **Multi-step coordination.** Agents perform sequences of actions where each step depends on the results of previous steps. State consistency across steps is critical.
4. **Heterogeneous ecosystems.** An agent may interact with many different applications, each with different data models. A protocol that abstracts across these differences is valuable.

These properties mean that the ideal API for human developers—REST, GraphQL, gRPC—is not optimal for AI agents. REST requires agents to know exact URLs and infer state from error responses. GraphQL provides flexible queries but still requires the agent to know the schema. SLOP addresses this by providing an application that *describes* its state and capabilities directly, in a form that matches how agents consume information: a tree of semantic units with actions attached.

### 2.3 What SLOP Enables

Consider an agent tasked with triaging bugs in a project management system:

- **With MCP:** The agent calls `list_repos`, then for each repo calls `list_issues`, then for each issue checks its state via separate `get_issue` calls, then calls `assign_issue`, `close_issue`, etc.—potentially 50+ tool calls with full discovery overhead for each step.

- **With SLOP:** The agent subscribes to the state tree, receives a snapshot showing all repos with their issues, and can see which issues are assignable (only unassigned ones carry the `assign` affordance). The agent batches its actions in 2-3 turns.

The state tree is the missing perception layer. SLOP fills it.

## 3 Related Work

### 3.1 Tool-Centric Protocols

**OpenAI Function Calling** [OpenAI 2023] pioneered the schema-first API paradigm for LLMs. The agent receives JSON schemas describing available functions and decides which to invoke. SLOP shares the schema-driven parameter validation (affordances use JSON Schema for parameters) but inverts the model: actions are not discovered from a flat list—they are discovered by examining the state nodes they operate on. An affordance's presence *is* the signal that it is applicable in the current state.

**Model Context Protocol (MCP)** [Anthropic 2024] extends function calling with a standardized discovery mechanism, resource schemas, and prompt injection. MCP's resource model—structured data that agents can read—is the closest existing analog to SLOP's state tree. However, MCP resources are still discovered and read through explicit tool calls (`tools/read`), whereas SLOP provides push-based subscription semantics. MCP's flat tool registry versus SLOP's contextual affordances represents the core architectural divergence.

**ReAct and Chain-of-Thought** [Yao et al. 2022] established the pattern of agents interleaving reasoning with action. These are reasoning frameworks, not communication protocols, but they highlight the importance of providing agents with both observations and actions in a unified context—which is what SLOP's state tree + affordance model delivers.

### 3.2 State Management for AI

**RAG (Retrieval-Augmented Generation)** [Lewis et al. 2020] addresses the context window problem by fetching relevant information on demand. SLOP takes a similar "fetch relevant information" philosophy but at the level of application state rather than unstructured documents. The progressive disclosure and salience filtering mechanisms serve the same purpose as RAG retrieval: give the agent the right information at the right time.

**Structured state for agents** has been explored in system-specific contexts: browser automation APIs (Playwright, Puppeteer) expose the DOM; IDE APIs expose editor state. SLOP's contribution is a *protocol*—an independent standard—that any application can implement, rather than a framework tied to a specific runtime.

**State machines and event sourcing** [Fowler 2014] provide the theoretical foundation for SLOP's incremental update model. The state tree is effectively a serialized snapshot of an application's state, and patches are delta updates. SLOP adapts these concepts to the specific constraints of AI consumption (token budgeting, attention management).

### 3.3 Multi-Agent Communication

**Message passing frameworks** (AutoGen [Wu et al. 2023], CrewAI) provide orchestration layers for multi-agent systems but rely on natural language for inter-agent communication. They lack a shared state model—each agent must independently discover and interpret the state of shared resources. SLOP provides the shared state layer that such frameworks could build on.

**Shared blackboard architectures** [Ernst 2019] have been used in multi-agent systems for decades. The blackboard is a shared data structure that agents read and write. SLOP's state tree is a formalized, protocol-standardized blackboard with well-defined message semantics, versioning, and subscription management.

## 4 SLOP Protocol Specification

### 4.1 Overview and Architecture

SLOP has four conceptual layers, each building on the one below:

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

A minimal SLOP implementation needs only the bottom two layers (transport and state tree). A complete implementation uses all four.

### 4.2 The State Tree

The state tree is a rooted tree of **nodes**. Each node represents a semantic unit of application state.

**Node schema:**

```jsonc
{
  // REQUIRED
  "id": "msg-42",          // Stable identifier, unique within the tree
  "type": "message",       // Semantic type

  // OPTIONAL
  "properties": {          // Key-value pairs — the actual state
    "from": "alice@co.org",
    "subject": "Launch plan",
    "unread": true
  },
  "children": [ ... ],     // Ordered list of child nodes
  "affordances": [ ... ],  // Actions available on this node
  "meta": { ... },         // Attention hints and metadata
  "content_ref": { ... }   // Reference to large content
}
```

**Core node types** include `root`, `view`, `collection`, `item`, `document`, `form`, `field`, `control`, `status`, `notification`, `media`, `group`, and `context`. Custom types use namespace prefixes (e.g., `github:pull-request`).

Node types are **semantic, not structural**—they describe meaning, not UI elements. An email inbox exposes `message` items, not `<div>` elements or database rows.

### 4.3 Progressive Disclosure and Depth Control

The state tree supports depth-controlled resolution. When a consumer requests a subtree at depth `d`:

- **Depth 0:** Only the requested node (no children)
- **Depth 1:** The node + direct children (children's children omitted)
- **Depth N:** N levels of nesting resolved
- **Depth -1:** Full subtree (unlimited depth)

Nodes beyond the requested depth are **stubs**—they include only `id`, `type`, and `meta` (especially `summary` and `total_children`) but not `properties`, `children`, or `affordances`.

```
Depth 0:
  inbox (12 unread, 142 total)

Depth 1:
  inbox
    ├── msg-1: "Launch plan" from alice (unread)
    ├── msg-2: "Bug report" from bob
    ... (25 of 142 shown)

Depth 2:
  inbox
    ├── msg-1: "Launch plan" from alice (unread)
    │   ├── attachment: "plan.pdf" (2.1 MB)
    │   └── thread: 3 replies
```

This mechanism allows the AI agent to control its token budget directly—starting with a high-level view and drilling into what is relevant.

### 4.4 Incremental Synchronization via Patches

After the initial `snapshot` response to a `subscribe` message, the provider streams incremental updates using **SLOP patches**, modeled on JSON Patch (RFC 6902) with SLOP-specific path syntax:

```jsonc
{
  "type": "patch",
  "subscription": "sub-1",
  "version": 2,
  "ops": [
    { "op": "replace", "path": "/inbox/msg-42/properties/unread", "value": false },
    { "op": "add", "path": "/inbox/msg-99", "value": { "id": "msg-99", "type": "item", ... } },
    { "op": "remove", "path": "/inbox/msg-10" }
  ]
}
```

SLOP patch paths use **node-ID segments** rather than array indices. A path like `/inbox/msg-42/properties/unread` references nodes by stable ID rather than position, making patches stable across reordering.

Versions are monotonically increasing integers scoped to a subscription. Consumers detect missed patches via version gaps and can request a fresh snapshot.

### 4.5 Affordances: Contextual Actions

Affordances are the action layer of SLOP. They describe what can be done, where, and how.

**Affordance schema:**

```jsonc
{
  "action": "reply",                    // Identifier
  "label": "Reply",                     // Human-readable label
  "description": "Reply to this message",
  "params": {                           // JSON Schema for parameters
    "type": "object",
    "properties": {
      "body": { "type": "string", "description": "Reply body text" },
      "reply_all": { "type": "boolean", "default": false }
    },
    "required": ["body"]
  },
  "dangerous": false,                   // Requires confirmation
  "idempotent": false,                  // Safe to retry
  "estimate": "instant"                 // Duration hint
}
```

**Key distinction from tools:** In MCP and function calling, the agent receives a flat list of available functions—disconnected from state. In SLOP, affordances are **attached to state nodes** and appear in context. A "merge" affordance appears on a pull request only when it is mergeable. Affordances change dynamically as state changes—the presence of an affordance *is* the signal that the action is applicable.

Affordances are invoked via the `invoke` message:

```jsonc
{
  "type": "invoke",
  "id": "inv-1",
  "path": "/prs/pr-123",
  "action": "merge",
  "params": {}
}
```

The provider validates the action against live state, session permissions, and resource policy before executing.

### 4.6 Attention and Salience

A state tree for a complex application can have thousands of nodes. Attention hints guide the agent's focus within its limited context window.

**Meta fields for attention:**

```jsonc
{
  "meta": {
    "salience": 0.9,          // 0–1, relevance score
    "changed": true,           // Modified in the last patch
    "focus": true,             // User is currently focused on this
    "urgency": "high",         // Time-sensitivity: none/low/medium/high/critical
    "reason": "User triggered this deploy 2 minutes ago"
  }
}
```

Consumers can filter subscriptions by salience:

```jsonc
{
  "type": "subscribe",
  "id": "sub-1",
  "filter": {
    "min_salience": 0.5
  }
}
```

This turns the agent's token budget into a dynamic filter—it sees what matters right now, and the boundary adjusts in real time as salience changes.

### 4.7 Transport and Discovery

SLOP is **transport-agnostic**. The protocol defines message semantics and types, but any transport satisfying three requirements (bidirectional messaging, ordered delivery, message framing) is acceptable:

- **Unix domain socket:** Local apps, low latency
- **WebSocket:** Web apps, remote connections
- **stdio:** CLI tools, subprocess-based providers
- **postMessage:** In-browser SPAs

**Discovery mechanism:** Providers register descriptors in well-known filesystem directories (`~/.slop/providers/`) with transport connection details and capability declarations. Web apps can also advertise SLOP support via HTML `<meta>` tags or `/.well-known/slop` endpoints.

**Connection lifecycle:**

```
Consumer                          Provider
   │──── connect ────────────────>│
   │<─── hello ──────────────────│   Provider advertises capabilities
   │──── subscribe ─────────────>│   Consumer requests state
   │<─── snapshot ───────────────│   Initial state
   │<─── patch ──────────────────│   Incremental updates
   │──── invoke ────────────────>│   Consumer triggers action
   │<─── result ─────────────────│
   │<─── patch ──────────────────│   State updated by action
```

### 4.8 Scaling Patterns

For applications with large state (thousands of nodes), SLOP defines several patterns:

**View-scoped trees:** The tree is organized around application views. The active view has full detail; inactive views are stubs with summaries.

**Windowed collections:** Large collections expose only a visible window with metadata about the full set (`total_children`, `window` offset). The agent can request different windows via `query` messages.

**Lazy subtrees:** Expensive-to-compute subtrees (message bodies, file contents, thread replies) are declared via `total_children` but not resolved until explicitly queried.

**Conservative design:** We implement a simple compaction strategy—collapsing subtrees by salience score—rather than a complex ranking algorithm. This keeps the provider-side computation predictable and the consumer-side control explicit.

### 4.9 Message Summary

The complete SLOP message space includes:

| Direction | Message | Purpose |
|-----------|---------|---------|
| Provider → Consumer | `hello` | Connection setup, capability advertisement |
| Provider → Consumer | `snapshot` | Full state (initial or query response) |
| Provider → Consumer | `patch` | Incremental state update |
| Provider → Consumer | `result` | Response to `invoke` |
| Provider → Consumer | `event` | Out-of-band notification |
| Consumer → Provider | `subscribe` | Begin observing a subtree |
| Consumer → Provider | `query` | One-shot state read |
| Consumer → Provider | `invoke` | Trigger an affordance |
| Consumer → Provider | `unsubscribe` | Stop observing |

All messages are JSON, with `type` as the required discriminator field and optional `id` for request-response correlation.

## 5 Use Cases and Case Studies

### 5.1 Case Study: Multi-Agent Creative Pipeline

Consider a creative workflow involving three specialized agents: a writer agent, a designer agent, and a publishing agent. The writer produces drafts, the designer generates visuals, and the publishing agent assembles and deploys content.

**Without SLOP:** Agents communicate via natural language messages over a messaging system. The writer must describe the draft in text (losing structure), the designer must ask clarifying questions, and the publisher has no visibility into the review pipeline's current state. Coordination requires explicit status reporting from each agent.

**With SLOP:** Each agent exposes its domain state as a SLOP tree:

- **Writer app:** Exposes `draft` nodes with `submit`, `revise`, `approve` affordances. Status nodes indicate review pipeline position.
- **Designer app:** Exposes `asset` nodes with `generate`, `approve`, `revise` affordances. Salience updates when a draft is approved and needs a visual.
- **Publishing app:** Exposes `article` nodes with `assemble`, `deploy`, `rollback` affordances. Only shows `deploy` when all assets are approved.

The designer agent subscribes to the writer's SLOP tree, monitors for drafts reaching "review" status (salience 1.0), and automatically begins generating visuals. The publishing agent observes all three trees and only exposes the `deploy` affordance when the full pipeline is complete. The state tree is the coordination substrate—agents don't negotiate over messages; they observe shared state.

### 5.2 Case Study: Developer IDE Agent

An AI agent interacting with a code editor (VS Code) needs to: find bugs, explain code, suggest fixes, and run tests.

**SLOP exposes:**

- Open files as `document` nodes with cursor position, selection, dirty state, and visible range
- Problems panel as a `collection` of `notification` nodes with severity, file, line number, and salience
- Terminal output as `status` nodes with last command and exit code
- Git state as `context` node (branch, dirty status, stashed changes)

**The agent workflow:** The agent subscribes with `min_salience: 0.5`, receiving only high-salience items (errors, focused file, active terminal). When it sees a type error with salience 1.0, it reads the full document node to understand the context, proposes a fix by invoking the `edit` affordance on the relevant line, and verifies the fix by observing the problems collection update.

This workflow eliminates the tool-discovery overhead: the agent doesn't call `get_file`, `get_errors`, `get_cursor_position` as separate tools—it reads them from a unified state tree.

### 5.3 Case Study: Multi-Application Agent Dashboard

An enterprise agent monitors a suite of applications: email, calendar, project tracker, and CI/CD pipeline. Each application runs as an independent SLOP provider.

The agent connects to all four providers and subscribes to high-salience state from each. Salience filtering ensures the agent receives only relevant notifications across all applications—a failing deployment from the CI system, an urgent email from the project lead, a calendar conflict from the scheduling app. The unified state model enables cross-application reasoning: the agent can correlate a CI failure with an email about a client escalation and infer a priority reordering.

Tree composition (combining multiple provider trees under a virtual root) is a planned extension that would formalize this use case at the protocol level.

## 6 Empirical Evaluation: SLOP vs MCP

### 6.1 Benchmark Methodology

We developed a head-to-head benchmark (`benchmarks/mcp-vs-slop`) comparing SLOP and MCP using an identical backing application—an in-memory issue tracker with repos, issues, comments, and labels. The benchmark runs 12 scenarios through both protocols, measuring:

- **Correctness:** Did the agent complete the task correctly?
- **LLM round trips:** Number of model API calls
- **Tool calls:** Number of individual tool invocations
- **Tokens:** Input and output token counts
- **Cost:** Estimated USD based on model pricing
- **Time:** Wall-clock duration

Scenarios include: simple exploration, bug triage, bulk updates, scale triage (10 repos, ~100 issues), negative tests (attempting impossible actions), multi-turn contextual tasks, state transitions, cross-entity reasoning, conditional logic, ambiguity resolution, and complex workflows (sprint planning).

### 6.2 Key Findings

**Correctness:** SLOP passes 12/12 scenarios. MCP passes 8/12, failing on:

- **Scale:** Discovery budget exhaustion on large datasets
- **Safety:** Inability to prevent invalid actions on already-closed issues (MCP's flat tool list always exposes `assign_issue` and `close_issue` regardless of issue state)
- **Complex reasoning:** Inability to aggregate state across repositories

**Efficiency:** SLOP uses 75–90% fewer LLM round trips on multi-entity tasks. The agent batches all actions in 2 turns vs. 8–21 discovery-then-act turns with MCP.

**Contextual affordances prevent invalid actions by design:** MCP's flat tool list always exposes `assign_issue` regardless of issue state. SLOP only shows the action on nodes where it is valid.

**Cost tradeoff:** SLOP's state tree uses more input tokens per observation (the agent receives the entire tree). For simple, single-entity tasks, MCP is cheaper. For complex tasks requiring cross-entity reasoning, SLOP is cheaper *and* correct where MCP fails.

### 6.3 Discussion

The results confirm our hypothesis: when agents need to understand and reason about application state before acting, a structured state model is superior to a flat tool registry. The cost of sending the state tree as input is amortized across multiple actions, and the reduction in incorrect actions (which require retries) more than compensates for the initial state transfer cost.

## 7 Design Principles for Agent-Native APIs

Drawing from SLOP's design and the empirical results, we derive five principles for designing APIs specifically for AI agents. We term these **"agent-native API"** principles:

### Principle 1: State Is the Primary Primitive

The API should expose *what is* before exposing *what can be done*. Actions should be derived from and attached to state, not enumerated in a disconnected registry.

**Rationale:** Agents reason about state before acting. Providing state first reduces the cognitive load of matching tools to context. In REST, the state is implicit (inferred from resource URLs); in SLOP, it is explicit and queryable.

**Application:** SLOP's state tree is the foundational layer. Affordances exist on state nodes, not separately. An action's presence is an implicit "I can do this *here* and *now*."

### Principle 2: Semantic Over Structural

The API should expose what the application *means*, not how it is built or rendered.

**Rationale:** Agents need domain semantics, not UI structure or database schema. A message is a `message` node with `from`, `subject`, `body` properties—not an HTTP endpoint, not a DOM element.

**Application:** SLOP node types are semantic (`message`, `document`, `status`), not structural (`div`, `table`, `row`). This decouples the API from implementation details and makes it robust to UI changes.

### Principle 3: Contextual Affordances Over Global Tool Lists

Actions should be discovered by examining the state they operate on, not by browsing a global registry.

**Rationale:** Tool registries are always partially stale—tools appear available that are not applicable in the current state. Contextual affordances are always current because they are part of the state.

**Application:** SLOP affordances are attached to nodes. The "merge" affordance appears on a PR only when CI passes. The "close" affordance disappears once an issue is closed.

### Principle 4: Token-Aware by Design

The API should support progressive disclosure and attention-aware filtering, recognizing that the consumer has a bounded context window.

**Rationale:** Unlike human users who can scroll and zoom, AI agents have a strict token budget. APIs that do not support progressive disclosure force an all-or-nothing trade-off: send the entire state (expensive) or risk omitting relevant state (risky).

**Application:** SLOP's depth control, salience filtering, windowed collections, and stub nodes all exist to let the agent manage its token budget. The consumer controls depth and filters; the provider provides accurate metadata.

### Principle 5: Push Semantics for Stateful Coordination

State changes should be pushed to observers, not pulled by repeated queries.

**Rationale:** Polling wastes tokens and introduces latency between state changes and agent awareness. Push semantics ensure the agent sees state changes in real time, enabling timely reactions.

**Application:** SLOP's subscription model provides a snapshot followed by incremental patches. The agent does not need to poll for changes—the provider pushes them.

## 8 Discussion: SLOP as API Design

### 8.1 The API Design Perspective

For API design researchers, SLOP offers several interesting properties:

**SLOP is an API that describes its own interface.** The state tree *is* the API contract. By reading the tree, an agent knows exactly what state exists and what actions are available. This is self-documenting in a way that REST OpenAPI specs are not for AI consumers—schemas are human-readable but not machine-actionable.

**Affordances are a form of type-directed dispatch.** In typed languages, the type system restricts which operations are valid on which values. SLOP's affordances provide the same guarantee at the API level: the set of valid actions on a node is determined by the node's current state, not by a global function registry. This is analogous to object-oriented method dispatch constrained by the object's type and state.

**Patches are event-sourced API responses.** The snapshot + patch model is a direct application of event sourcing: the current state is a snapshot, and all subsequent changes are deltas. This gives the API the same properties as event-sourced systems: auditability, replayability, and efficient updates.

**SLOP inverts the traditional API design question.** Traditional API design asks: "What resources does the application have, and how do clients interact with them?" SLOP asks: "What can an AI agent *do* with this application, and what state does it need to know to do it safely?" The answer to the second question is the state tree, not a set of REST endpoints.

### 8.2 Comparison with Traditional API Paradigms

| Aspect | REST | GraphQL | SLOP |
|--------|------|---------|------|
| Data model | Resource-oriented | Query-oriented | State tree |
| Actions | HTTP methods | Mutations | Affordances on nodes |
| State discovery | URL knowledge | Schema introspection | Subscribe & observe |
| Updates | Polling / webhooks | Subscriptions | Push patches |
| Agent-friendly | No | Partial | Designed for AI |
| Context awareness | No | No | Yes (contextual affordances) |
| Token budget | N/A | N/A | Depth + salience |

### 8.3 Limitations and Future Work

Several aspects of SLOP remain incomplete:

**Multi-user support:** Server-side providers currently expose a single shared tree to all consumers. Session-scoped tree rendering is needed for production multi-user applications.

**Reconnection:** Connection drops are currently terminal. Automatic reconnection with version-based catch-up is planned.

**Tree composition:** When an agent connects to multiple providers, the trees remain separate. A consumer-side merge utility would unify the view.

**Backpressure:** Formal `pause`/`resume` flow control messages are specified but not yet implemented.

**Network discovery:** Remote provider discovery (mDNS/DNS-SD) is reserved but not specified in v0.1.

These limitations do not undermine SLOP's core contribution: a structured, push-based state model for AI consumption. They are incremental improvements to the operational properties of the protocol.

## 9 Conclusion

SLOP presents a protocol for exposing application state to AI agents in a structured, semantic, and agent-optimized form. By replacing the flat tool-calling model with a state tree model enriched with contextual affordances, progressive disclosure, and attention-aware subscriptions, SLOP enables agents to reason about application state before acting, reducing round-trip counts and improving correctness on complex, stateful tasks.

The protocol is designed with API design principles in mind: self-documenting through state, type-directed through affordances, event-sourced through patches, and agent-optimized through token-aware primitives. For API design researchers, SLOP offers a new lens: designing APIs not for human developers or even traditional software clients, but for autonomous AI agents with fundamentally different consumption patterns.

As autonomous agents become more prevalent in software ecosystems, the question of how to expose application state and capabilities to these agents becomes central. SLOP is one answer to this question—one that prioritizes structured state, contextual actions, and agent-aware design. We hope it provokes discussion within the API design and multi-agent systems communities about what APIs should look like for an AI-first world.

## Acknowledgments

The author thanks Prof. Cesare Pautasso (USI Lugano) for foundational guidance in API design and software engineering principles. Thanks also to the SLOP community contributors and the users who provided feedback during prototyping.

## References

[1] Anthropic. "Model Context Protocol." 2024. https://modelcontextprotocol.io

[2] OpenAI. "Function Calling Documentation." 2023. https://platform.openai.com/docs/guides/function-calling

[3] Yao, S., et al. "ReAct: Synergizing Reasoning and Acting in Language Models." ICLR 2022.

[4] Lewis, P., et al. "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks." NeurIPS 2020.

[5] Wu, T., et al. "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." 2023.

[6] Fowler, M. "Event Sourcing." Martyn Fowler, 2014. https://martinfowler.com/eaaDev/EventSourcing.html

[7] Ernst, M. A Blackboard-Based Multi-Agent Framework for Software Testing. 2019.

[8] RFC 6902: JSON Patch. IETF, 2013. https://datatracker.ietf.org/doc/html/rfc6902
