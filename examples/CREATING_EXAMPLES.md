# Creating Examples

This document describes how to create new SLOP examples. Follow this process to produce a `BLUEPRINT.md` and `GUIDE.md` that are consistent with existing examples and can be handed directly to an AI agent for implementation.

## Process

### 1. Pick the category

Examples are organized by integration pattern:

| Category | When to use | Transport | SDK side |
|---|---|---|---|
| `cli/` | Terminal tools, daemons, background services | stdio, unix socket | Server SDK |
| `spa/` | Client-only browser apps, local-first apps | postMessage | Client SDK + framework hooks |
| `full-stack/` | Server-rendered apps, APIs with UI | WebSocket, HTTP | Server SDK + client SDK + framework adapter |

If your example doesn't fit an existing category, create a new directory at `examples/<category>/`.

### 2. Choose which SLOP features to showcase

Each example should demonstrate a specific *set* of features. Don't try to showcase everything — pick the features that make sense for the app concept.

Reference the spec docs at `spec/` by number:

| Feature | Spec | Good fit for |
|---|---|---|
| State tree basics | 02 | All examples (required) |
| Stdio transport | 03 | CLI tools |
| WebSocket transport | 03 | Full-stack, services |
| postMessage transport | 03 | SPAs |
| Discovery | 03 | CLI tools, desktop apps |
| Affordances + params | 05 | All examples (required) |
| Salience & urgency | 06 | Apps with priorities, notifications, time-sensitivity |
| `--slop` flag pattern | 07 | CLI tools |
| Framework adapters | 07 | SPAs, full-stack |
| Windowed collections | 09 | Apps with large lists (email, logs, products) |
| Depth control | 09 | Apps with deep nesting |
| View-scoped trees | 09 | Multi-page apps |
| Content references | 13 | Apps with documents, files, long text |
| Async actions | 14 | Apps with slow operations (export, deploy, sync) |

### 3. Write the BLUEPRINT.md

The blueprint is the **implementation contract**. An AI agent should be able to read it and produce a complete, correct implementation without asking questions.

#### Required sections

```markdown
# <Category> Blueprint: `<name>` — <Short Description>

One paragraph: what this app is and why it's a compelling SLOP example.

## What this demonstrates

Table mapping SLOP features to how they're used in this example.
Reference spec numbers. This helps the implementer know which
spec docs to read.

## App behavior

Show the app from the user's perspective. Use shell transcripts,
screenshots descriptions, or UI mockups. The reader should understand
what the app *does* before seeing the SLOP tree.

## Data model

How state is stored (file, in-memory, database). Include the schema.
For CLI tools: the JSON file format.
For SPAs: the state shape (useState, store, etc.)
For full-stack: the API/database schema.

## SLOP tree

The exact tree structure. This is the core of the blueprint.
Use the indented notation:

  [root] app-name
    properties: { ... }
    affordances: [action(param: type)]
    |
    ├── [type] node-id
    │   properties: { ... }
    │   meta: { salience: 0.8 }
    │   affordances: [...]

Every node ID, type, property key, affordance name, and param schema
is part of the contract. Two implementations producing this tree
are functionally identical.

## Affordance schemas

Full JSON schema for every action's params. Group by scope
(root, collection, item). Include metadata: dangerous, idempotent,
estimate.

## Interactions

Step-by-step scenarios. Each one is a mini acceptance test:

  1. What triggers the interaction (user action or AI decision)
  2. What the AI sees in the tree
  3. What the AI invokes
  4. What the provider does
  5. What patches the consumer receives
  6. What the end state looks like

Include at least:
  - A read-only scenario (AI answers a question from tree state)
  - A mutation scenario (AI invokes an action, state changes)
  - A scenario for each "special" feature (content refs, async, etc.)

## Implementation constraints

- Which SDK to use (package name per language)
- Transport type
- External dependencies (none, or list them)
- Data storage location
- Binary/script name
- File structure for each implementation

## Seed data

Shared across all implementations. Include the full JSON inline.
Design seed data to exercise the features you're showcasing:
  - If you demo salience: include items at different priority levels
  - If you demo windowing: include enough items to exceed the window
  - If you demo content refs: include items with and without content
  - If you demo async: include state that triggers async operations
```

#### Tips for good blueprints

**The tree is the spec.** Spend most of your time on the SLOP tree section. If the tree is precise, the implementation follows mechanically.

**Be concrete, not abstract.** Use real data ("Buy groceries", not "Task 1"). Real data makes the example compelling and exposes edge cases.

**Design for the demo.** The seed data should produce an interesting tree on first run. Include overdue items, completed items, items with content — whatever makes the example worth exploring.

**Affordances are the API.** Every mutation the user or AI can perform must be an affordance with a full param schema. If it's not in the affordance list, it doesn't exist.

**Salience tells a story.** Don't make all items equal. The whole point of salience is that some things matter more. Design the data so the salience ordering is interesting.

### 4. Write the GUIDE.md

The guide is the **user walkthrough**. Someone reads this to understand what SLOP does by experiencing it hands-on.

#### Structure

```markdown
# Guide: Exploring <app-name>

## Setup
How to build and run (one block per language).
How to seed the data.

## Part 1: Normal mode
Walk through the app as a regular user. Show the output.
This establishes the baseline — "here's a normal app."

## Part 2: SLOP mode
Run the same app with SLOP enabled. Show what changes:
  - The hello message
  - Subscribing and seeing the snapshot
  - Side-by-side: what the human sees vs what the AI sees
  - Invoking an action via SLOP
  - Each special feature (content refs, salience, async)

## Part 3: Side by side
Run both modes. Make changes in one, see them in the other.
End with the takeaway: same app, same state, different interface.
```

#### Tips for good guides

**Show, don't explain.** Use shell transcripts and JSON output liberally. The reader should be able to follow along in their terminal.

**Compare visually.** The most powerful moment is seeing the same task as `[ ] Call dentist  overdue!` (human) and as a structured JSON node with salience 1.0 and urgency "high" (AI). Make this comparison explicit.

**Build incrementally.** Start with the simplest interaction (read the list), then add mutations, then show advanced features. Don't dump everything at once.

**End with the punchline.** Every guide should end with the core insight — there's one app, one state, two interfaces. SLOP doesn't create a separate "AI version" of your app.

### 5. Implement

With the blueprint and guide done, create implementations:

```
examples/<category>/<language>/
├── README.md       # Build and run instructions (short)
├── seed.json       # Copied from blueprint (identical across languages)
└── src/            # Source code
```

To delegate to an AI agent:

```
Read examples/<category>/BLUEPRINT.md.
Implement it in <language> using the <sdk-name> SDK at packages/<language>/slop-ai.
Put the implementation in examples/<category>/<language>/.
Refer to packages/<language>/slop-ai/src/ for SDK API patterns.
```

The agent has everything it needs in the blueprint. The guide is for humans exploring the result, not for the implementing agent.

## Checklist

Before considering an example complete:

- [ ] `BLUEPRINT.md` exists with all required sections
- [ ] `GUIDE.md` exists with setup, normal mode, SLOP mode, side-by-side sections
- [ ] `seed.json` is shared across all implementations (byte-identical)
- [ ] At least one language implementation exists and runs
- [ ] Normal mode works as described in the guide
- [ ] SLOP mode produces the tree described in the blueprint
- [ ] All affordances listed in the blueprint are functional
- [ ] All interaction scenarios from the blueprint work end-to-end
- [ ] Discovery file is written/cleaned up (if applicable)
- [ ] `README.md` in each implementation has build + run instructions
