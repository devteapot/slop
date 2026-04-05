#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createDiscoveryService } from "./discovery";
import { createToolHandlers } from "./tools";
import { createStateCache, type StateCache } from "./state-cache";

const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
const isPluginMode = !!pluginDataDir;

const discovery = createDiscoveryService({
  autoConnect: isPluginMode,
});
const handlers = createToolHandlers(discovery);

let cache: StateCache | null = null;
if (pluginDataDir) {
  cache = createStateCache(pluginDataDir, discovery);
}

const server = new McpServer({
  name: "slop",
  version: "0.1.0",
});

// @ts-expect-error — MCP SDK's server.tool() has excessively deep type instantiation with Zod
server.tool(
  "connected_apps",
  isPluginMode
    ? "View applications running on this computer. Usually state is already in context — " +
      "use this only to refresh state or connect to a newly discovered app."
    : "View applications running on this computer that you can observe and control. " +
      "Call without arguments to list all available apps. " +
      "Call with an app name or ID to connect (if needed) and see its full current state and every action you can perform.",
  {
    app: z
      .string()
      .optional()
      .describe("App name or ID to get detailed state for. Omit to list all apps."),
  },
  async (args) => handlers.connectedApps(args),
);

server.tool(
  "disconnect_app",
  "Disconnect from an application. Removes its action tools and stops state updates. " +
    "Use when you're done interacting with an app.",
  {
    app: z.string().describe("App name or ID to disconnect from."),
  },
  async (args) => handlers.disconnectApp(args),
);

discovery.start();
cache?.start();

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  cache?.stop();
  discovery.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cache?.stop();
  discovery.stop();
  process.exit(0);
});
