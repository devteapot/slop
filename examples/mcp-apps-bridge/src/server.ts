// Minimal MCP server (stdio) for the mcp-apps-bridge demo.
// Exposes a single tool `open_kanban` that opens the SLOP-powered kanban iframe.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSlopView } from "@slop-ai/mcp-apps-bridge/server";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const iframePath = join(here, "iframe.html");

const server = new McpServer(
  { name: "mcp-apps-bridge-demo", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

registerSlopView(server, {
  toolName: "open_kanban",
  description: "Open a live view of the SLOP-backed kanban board",
  resourceUri: "ui://mcp-apps-bridge-demo/kanban",
  resourceName: "Kanban View",
  html: () => readFile(iframePath, "utf8"),
});

const transport = new StdioServerTransport();
await server.connect(transport);
