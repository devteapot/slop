# SLOP Benchmarks v2 — Experiment rig (WIP)

Successor to [`benchmarks/mcp-vs-slop`](../mcp-vs-slop/). v1 stays in place as a regression anchor; v2 turns it into a proper experiment framework so we can drive SLOP v0.2 spec decisions from data.

Design spec: [fluffy-napping-walrus.md](../../.claude/plans/fluffy-napping-walrus.md) (local plan file).

## Status

- [x] Phase A — DGX inference path (OpenAI-compat provider + smoke test)
- [ ] Phase B — Sweep runner + config matrix
- [ ] Phase C — Prompt / encoding / optimization variants
- [ ] Phase C' — Fair-MCP variants
- [ ] Phase D — Metrics + statistical post-processing
- [ ] Phase E — Static dashboard
- [ ] Phase F — App complexity ladder (todo, file-browser, crm)

## DGX Spark setup

Models are served via Ollama on `slopinator-s-1.local`. The systemd unit has an override that binds Ollama to all interfaces on both address families:

```ini
# /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment=OLLAMA_HOST=[::]:11434
```

`::` binds IPv4 and IPv6 — required because Bun's fetch resolves `.local` names to IPv6 first and doesn't fall back. If the override is ever lost, Bun will report `ConnectionRefused` while curl still works; that's the tell.

## Smoke test

```bash
cd benchmarks/v2
bun run smoke/provider-test.ts
SLOP_SMOKE_MODEL=nemotron-3-super:120b bun run smoke/provider-test.ts
```

Runs a multi-turn tool-calling conversation (weather lookup → answer) against the configured model. Prints per-turn token counts, latency, and whether the model successfully delivered the final answer tool-call. Fails loudly if the OpenAI-compat endpoint misbehaves.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `SLOP_DGX_URL` | `http://slopinator-s-1.local:11434/v1` | Override to point at a different host |
| `SLOP_SMOKE_MODEL` | `gemma4:31b` | Any model in `ollama list` |

## Layout (target)

```
v2/
├── providers/              # LlmProvider interface + adapters
│   ├── types.ts
│   └── openai-compat.ts    # Ollama, vLLM, OpenAI, anything /v1-compatible
├── variants/               # prompts/, encodings/, optimizations/ (Phase C)
├── mcp-variants/           # fair-MCP pass (Phase C')
├── apps/                   # todo / file-browser / issue-tracker / crm (Phase F)
├── scenarios/              # shared scenario types
├── metrics/                # collectors + stats (Phase D)
├── runner/                 # sweep orchestrator (Phase B)
├── dashboard/              # static HTML report (Phase E)
└── smoke/                  # validation scripts
```
