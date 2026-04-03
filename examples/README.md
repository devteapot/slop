# Examples

Examples are organized by integration pattern:

| Directory | Pattern | What it demonstrates |
|---|---|---|
| `cli/` | CLI tool with `--slop` flag | Stdio transport, server SDK, discovery |
| `spa/` | Single-page app (client-only) | postMessage transport, framework hooks |
| `full-stack/` | Server + client | WebSocket transport, SSR, meta-framework adapters |

## Blueprints

Each directory contains a `BLUEPRINT.md` that fully specifies the example app — what it does, the exact SLOP tree it exposes, the affordances, interaction scenarios, and implementation constraints.

The blueprint is **language-agnostic**. All implementations within a directory must produce the same SLOP tree and support the same interactions. The blueprint is the contract.

### Using a blueprint

To implement an example in a new language, give an AI agent:

```
Implement the example described in examples/cli/BLUEPRINT.md using Go.
Use the slop-ai Go SDK at packages/go/slop-ai.
Put the implementation in examples/cli/go/.
```

The blueprint contains everything the agent needs — no follow-up questions required.

### Writing a blueprint

A blueprint must include:

1. **What this demonstrates** — which SLOP features are showcased
2. **App behavior** — what the app does from the user's perspective
3. **SLOP tree** — the exact tree structure (node IDs, types, properties, affordances, meta)
4. **Affordance schemas** — full JSON schema for every action's params
5. **Interactions** — step-by-step scenarios usable as acceptance tests
6. **Implementation constraints** — SDK to use, transport, dependencies, file structure
7. **Seed data** — shared across all implementations (identical JSON)

The SLOP tree is the core of the blueprint. If two implementations produce the same tree and handle the same affordances, they are functionally identical.
