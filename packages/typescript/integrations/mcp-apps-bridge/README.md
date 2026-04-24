# @slop-ai/mcp-apps-bridge

Render a SLOP provider inside an MCP Apps iframe.

The bridge demultiplexes the sandboxed iframe's `postMessage` channel between MCP Apps (ext-apps `App`) and SLOP (snapshots, patches, invocations), then projects salience-filtered state into `app.updateModelContext()` so the host model sees what the user sees.

See the [MCP Apps Bridge guide](https://docs.slopai.dev/guides/advanced/mcp-bridge/) for end-to-end setup, and the [demo](https://github.com/devteapot/slop/tree/main/examples/mcp-apps-bridge) for a runnable reference.

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
});
```
