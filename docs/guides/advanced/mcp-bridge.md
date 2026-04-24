# MCP Apps Bridge

Expose a SLOP provider inside an MCP Apps host (Claude, ChatGPT, Goose, VS Code) so an embedded SLOP consumer can subscribe to live state, project selected state into model context, and invoke affordances from the chat surface.

This guide is the developer-facing complement to the normative [MCP Interoperability](../../../spec/integrations/mcp.md) spec.

## When to use this

Use the MCP Apps bridge when:

- Your users interact with SLOP-aware apps through Claude or ChatGPT rather than a standalone SLOP consumer.
- You want a single integration that reaches MCP Apps hosts without implementing each host's UI extension API separately.
- You already have a SLOP provider and do not want to rewrite it as an MCP tool server.

Use the [MCP proxy](./claude-code.md) instead when your target host doesn't support MCP Apps yet, or when you want a flat tool catalog rather than live state.

## How it works

MCP Apps lets an MCP tool return a `ui://` resource. The host fetches it and renders it in a sandboxed iframe, wiring a JSON-RPC channel over `postMessage`. That `postMessage` channel is already a [native SLOP transport](../../../spec/core/transport.md#postmessage-convention), so the bridge is a thin multiplexer.

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

1. **Expose one MCP Apps tool** whose sole job is to open the view:

   ```ts
   import {
     RESOURCE_MIME_TYPE,
     registerAppResource,
     registerAppTool,
   } from "@modelcontextprotocol/ext-apps/server";
   import { readFile } from "node:fs/promises";

   const resourceUri = "ui://your-app/slop";

   registerAppTool(
     server,
     "open_slop_view",
     {
       description: "Open a live view of your app state",
       inputSchema: {},
       _meta: { ui: { resourceUri } },
     },
     async () => ({ content: [] }),
   );

   registerAppResource(
     server,
     "SLOP View",
     resourceUri,
     {},
     async () => {
       const html = await readFile(new URL("./dist/slop.html", import.meta.url), "utf8");
       return {
         contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
       };
     },
   );
   ```

   `registerAppResource`'s second argument is a display name for the host. The `RESOURCE_MIME_TYPE` default is supplied by the helper, so the metadata object can be empty; it's still set explicitly on the returned `contents[]` so the host sees the MCP Apps MIME type.

2. **Serve the UI resource** as a static HTML bundle that loads `@slop-ai/spa` (for in-iframe providers) or `@slop-ai/consumer` + a WebSocket relay (for remote providers).

3. **Project state into the model** by calling `app.updateModelContext()` with a salience-filtered snapshot whenever the SLOP consumer receives a meaningful snapshot or patch. Do not ship raw trees — the model's context window is limited; use `min_salience` on the subscription and debounce updates.

4. **Route invocations** from the UI to the SLOP provider. If you want the model itself to call affordances, expose each affordance as an MCP tool on the server and forward the invocation through the iframe.

## Security

The host's iframe sandbox and user-consent prompts are defense in depth. They are **not** the authorization boundary. Your SLOP provider must re-authorize every affordance invocation against live state and caller identity, exactly as it would for a direct WebSocket consumer.

For remote providers, the iframe's WebSocket relay should use a short-lived token minted by your backend for that app session. Do not put provider bearer tokens into MCP tool `content`, `structuredContent`, or any model-visible context. Keep iframe origins and CSP as narrow as the host allows.

## Limitations

- **No native model-visible SLOP subscription.** MCP resources can support change subscriptions, and Streamable HTTP can carry server-to-client notifications, but MCP Apps still require explicit model-context updates. Debounce `updateModelContext` — every call consumes context tokens.
- **No cross-tool affordances.** An affordance triggered from the UI runs through the bridge, not as a first-class MCP tool call, so the model doesn't see it in its tool trace. If you want the model to invoke affordances, publish them as MCP tools as well.
- **Host support is uneven.** MCP Apps shipped in January 2026. Older MCP hosts fall back to rendering the tool's text result; ship a plain-text summary alongside the `ui://` resource for graceful degradation.

## Future direction

If MCP standardizes event-driven resource updates or a SLOP-specific extension, the bridge can move from `updateModelContext` projections to a direct `slop/subscribe` stream over MCP. See the [MCP extension future work entry](../../../spec/limitations.md#no-formal-mcp-extension) for the planned SEP.
