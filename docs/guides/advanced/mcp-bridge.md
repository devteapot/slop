# MCP Apps Bridge

Expose a SLOP provider inside an MCP Apps host (Claude, ChatGPT, Goose, VS Code) so the model can subscribe to live state and invoke affordances from the chat surface.

This guide is the developer-facing complement to the normative [MCP Interoperability](https://docs.slopai.dev/spec/integrations/mcp/) spec.

## When to use this

Use the MCP Apps bridge when:

- Your users interact with SLOP-aware apps through Claude or ChatGPT rather than a standalone SLOP consumer.
- You want a single integration that reaches every MCP Apps host without implementing each host's UI extension API separately.
- You already have a SLOP provider and do not want to rewrite it as an MCP tool server.

Use the [MCP proxy](./claude-code.md) instead when your target host doesn't support MCP Apps yet, or when you want a flat tool catalog rather than live state.

## How it works

MCP Apps lets an MCP tool return a `ui://` resource. The host fetches it and renders it in a sandboxed iframe, wiring a JSON-RPC channel over `postMessage`. That `postMessage` channel is already a [native SLOP transport](https://docs.slopai.dev/spec/core/transport/#postmessage-convention), so the bridge is a thin multiplexer.

```
MCP host ──► open_slop_view tool
                │
                ▼
        iframe (ui://slop/...)
        ├── @slop-ai/spa consumer
        └── SLOP provider (in-iframe OR WS relay)
```

Inside the iframe, SLOP frames carry `{ slop: true, message }`. MCP Apps frames don't. The adapter routes on that field.

## Minimum integration

1. **Expose one MCP tool** whose sole job is to open the view:

   ```ts
   server.tool("open_slop_view", {
     description: "Open a live view of <your app> state",
     inputSchema: {},
     _meta: { ui: { resourceUri: "ui://your-app/slop" } },
   }, async () => ({ content: [] }));
   ```

2. **Serve the UI resource** as a static HTML bundle that loads `@slop-ai/spa` (for in-iframe providers) or `@slop-ai/consumer` + a WebSocket relay (for remote providers).

3. **Project state into the model** by calling `app.updateModelContext()` with a salience-filtered snapshot whenever the SLOP consumer receives a new snapshot or patch. Do not ship raw trees — the model's context window is limited; use `min_salience` on the subscription.

4. **Route invocations** from the UI to the SLOP provider. If you want the model itself to call affordances, expose each affordance as an MCP tool on the server and forward the invocation through the iframe.

## Security

The host's iframe sandbox and user-consent prompts are defense in depth. They are **not** the authorization boundary. Your SLOP provider must re-authorize every affordance invocation against live state and caller identity, exactly as it would for a direct WebSocket consumer. A bridge that trusts its peer is a bridge that leaks.

For remote providers, the iframe's WebSocket relay must carry a bearer token negotiated out of band. Do not rely on the MCP host to inject credentials.

## Limitations

- **No subscription push to the model.** MCP has no native subscription primitive yet; state updates reach the model only when you explicitly call `updateModelContext`. Debounce this — every call consumes context tokens.
- **No cross-tool affordances.** An affordance triggered from the UI runs through the bridge, not as a first-class MCP tool call, so the model doesn't see it in its tool trace. If you want the model to invoke affordances, publish them as MCP tools as well.
- **Host support is uneven.** MCP Apps shipped in January 2026. Older MCP hosts fall back to rendering the tool's text result; ship a plain-text summary alongside the `ui://` resource for graceful degradation.

## Future direction

Once MCP's explicit subscription-stream transport stabilizes (tracked on the [MCP 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)), the bridge will switch from out-of-band `updateModelContext` to a direct `slop/subscribe` stream over the MCP wire. See the [MCP extension future work entry](https://docs.slopai.dev/spec/limitations/#no-formal-mcp-extension) for the planned SEP.
