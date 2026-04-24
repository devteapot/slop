# @slop-ai/mcp-apps-bridge

Render a SLOP provider inside an MCP Apps iframe.

The bridge demultiplexes the sandboxed iframe's `postMessage` channel between MCP Apps (ext-apps `App`) and SLOP (snapshots, patches, invocations), then projects salience-filtered state into `app.updateModelContext()` so the host model sees what the user sees.

See the [MCP Apps Bridge guide](https://docs.slopai.dev/guides/advanced/mcp-bridge/) for end-to-end setup, the [MCP Interoperability spec](https://docs.slopai.dev/spec/integrations/mcp/) for the protocol-level contract, and the [demo](https://github.com/devteapot/slop/tree/main/examples/mcp-apps-bridge) for a runnable reference.

## Install

```bash
bun add @slop-ai/mcp-apps-bridge @modelcontextprotocol/ext-apps
```

## Iframe

```ts
import { createMcpAppsBridge } from "@slop-ai/mcp-apps-bridge";

const bridge = await createMcpAppsBridge({
  provider: { mode: "ws", url: "ws://localhost:3737/slop" },
  subscribe: { depth: -1, minSalience: 0.3 },
});
```

## MCP server

```ts
import { registerSlopView } from "@slop-ai/mcp-apps-bridge/server";

registerSlopView(server, {
  toolName: "open_kanban",
  description: "Live kanban board",
  resourceUri: "ui://kanban/slop",
  html: await readFile(new URL("./dist/slop.html", import.meta.url), "utf8"),
  // Required when the iframe in `ws` mode runs in a sandboxed host (VS Code,
  // Claude). Whitelists the origins the iframe is allowed to reach. Must
  // include the SLOP provider URL above.
  connectDomains: ["ws://localhost:3737"],
});
```

Pair with `registerSlopTools(server, { url })` if you also want the model to invoke SLOP affordances directly from chat. See the [full guide](https://docs.slopai.dev/guides/advanced/mcp-bridge/) for the complete setup including the WS provider process.
