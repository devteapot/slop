# @slop-ai/mcp-apps-bridge

Installable MCP Apps bridge for local SLOP providers.

Run it as a stdio MCP server and connect it to an MCP Apps host. It discovers SLOP apps through `@slop-ai/discovery`, exposes `open_app`, serves a generic interactive `ui://` view, and mirrors SLOP affordances as MCP tools.

See the [MCP Apps Bridge guide](https://docs.slopai.dev/guides/advanced/mcp-bridge/) for architecture details and [`examples/mcp-apps-bridge`](https://github.com/devteapot/slop/tree/main/examples/mcp-apps-bridge) for a custom app-specific bridge.

## Quick start

No project setup is required for the default local bridge:

```bash
npx -y @slop-ai/mcp-apps-bridge
```

The command starts a stdio MCP server. It writes logs to stderr and keeps stdout reserved for MCP, so most users run it through a client configuration rather than directly in a terminal.

## Consumer configs

### VS Code

Open `MCP: Open User Configuration` or add `.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "slop": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@slop-ai/mcp-apps-bridge"]
    }
  }
}
```

Reload the window, start the server from `MCP: List Servers`, then ask Copilot Chat:

```text
List my SLOP apps, then open the kanban app.
```

### Claude Desktop

Add the server under `mcpServers` in `claude_desktop_config.json`, then restart Claude:

```json
{
  "mcpServers": {
    "slop": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@slop-ai/mcp-apps-bridge"]
    }
  }
}
```

Ask Claude to list SLOP apps or call `open_app`. If your Claude host supports MCP Apps resources, it will render the `ui://` view. If it only supports tools, it can still call the generated SLOP action tools.

### Goose

Add a command-line extension in Goose Desktop, or edit `~/.config/goose/config.yaml`:

```yaml
extensions:
  slop:
    type: stdio
    cmd: npx
    args: ["-y", "@slop-ai/mcp-apps-bridge"]
    enabled: true
```

Restart Goose and ask it to open a discovered SLOP app.

### MCP Inspector

Use the inspector for a quick local smoke test:

```bash
bunx @modelcontextprotocol/inspector npx -y @slop-ai/mcp-apps-bridge
```

Call `list_apps`, then call `open_app` with an app name or ID.

### Tool-only MCP clients

Clients that support MCP tools but not MCP Apps iframes can still use the server. They will not render the generic app view, but they can call:

- `list_apps`
- `open_app`
- `app_action`
- `app_action_batch`
- dynamic app-specific tools registered from connected affordances

## What the server exposes

| Tool | Purpose |
| --- | --- |
| `list_apps` | Lists discovered SLOP providers from local descriptor files and the browser bridge. |
| `open_app` | Connects to a provider, returns its current state, and opens the generic MCP Apps view. |
| `slop_get_state` | App-only helper used by the generic iframe to refresh provider state. |
| `app_action` | Invokes one SLOP affordance by app, path, action, and params. |
| `app_action_batch` | Invokes multiple affordances sequentially in one call. |
| dynamic tools | When an app is connected, its affordances are exposed as namespaced MCP tools such as `kanban__todo__add_card`. |

The generic view refreshes state through app-only server tools, so it can display providers discovered through Unix sockets, WebSockets, and the local browser bridge. It also calls `app.updateModelContext()` with the visible state so later model turns can reason over the app without another read tool call.

## Local install

For a pinned local install:

```bash
bun add @slop-ai/mcp-apps-bridge
```

Then point clients at the installed bin:

```json
{
  "servers": {
    "slop": {
      "type": "stdio",
      "command": "bunx",
      "args": ["slop-mcp-apps-bridge"]
    }
  }
}
```

## Library API

The package still exports primitives for custom MCP App servers. Use these when you want an app-specific iframe instead of the generic discovery view.

### Iframe bundle

```ts
import { createMcpAppsBridge } from "@slop-ai/mcp-apps-bridge";

const root = document.getElementById("app");

const bridge = await createMcpAppsBridge({
  provider: { mode: "ws", url: "ws://localhost:3737/slop" },
  subscribe: { depth: -1, minSalience: 0.3 },
  projection: { header: "# Local SLOP app" },
});

function render() {
  if (!root) return;
  root.textContent = JSON.stringify(bridge.getTree(), null, 2);
}

render();
bridge.consumer.on("patch", render);
```

### MCP server helpers

```ts
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSlopTools, registerSlopView } from "@slop-ai/mcp-apps-bridge/server";

const SLOP_URL = process.env.SLOP_URL ?? "ws://127.0.0.1:3737/slop";
const RESOURCE_URI = "ui://local-slop/app";

const server = new McpServer(
  { name: "local-slop", version: "0.1.0" },
  { capabilities: { tools: { listChanged: true }, resources: {} } },
);

registerSlopView(server, {
  toolName: "open_slop_app",
  description: "Open the live SLOP app",
  resourceUri: RESOURCE_URI,
  html: () => readFile(new URL("./iframe.html", import.meta.url), "utf8"),
  connectDomains: [new URL(SLOP_URL).origin],
});

await registerSlopTools(server, {
  url: SLOP_URL,
  uiResourceUri: RESOURCE_URI,
});

await server.connect(new StdioServerTransport());
```

Use the custom helper path when you already have a known WebSocket provider and want a tailored UI. Use the default `slop-mcp-apps-bridge` binary when you want local discovery and a generic view.
