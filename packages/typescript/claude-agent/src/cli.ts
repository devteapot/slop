#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createDiscoveryService } from "./discovery";
import { createToolHandlers } from "./tools";

const discovery = createDiscoveryService();
const handlers = createToolHandlers(discovery);

const server = new McpServer({
  name: "slop",
  version: "0.1.0",
});

// @ts-expect-error — MCP SDK's server.tool() has excessively deep type instantiation with Zod
server.tool(
  "connected_apps",
  "View applications running on this computer that you can observe and control. " +
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
  "app_action",
  "Perform an action on an application — add items, edit content, toggle state, " +
    "delete entries, move things around, start/stop processes, etc. " +
    "IMPORTANT: Always call connected_apps with the app name FIRST to see the exact state tree, " +
    "node paths, action names, and parameter values. Do not guess — use the exact IDs shown.",
  {
    app: z.string().describe("App name or ID (from connected_apps)"),
    path: z.string().describe("Path to the item to act on, e.g. '/' for root, '/todos/todo-1'"),
    action: z.string().describe("Action to perform, e.g. 'add_card', 'toggle', 'delete'"),
    params: z.string().optional().describe("Action parameters as JSON string, e.g. '{\"title\": \"New task\"}'"),
  },
  async (args) =>
    handlers.appAction({
      app: args.app,
      path: args.path,
      action: args.action,
      params: args.params ? JSON.parse(args.params) : undefined,
    }),
);

server.tool(
  "app_action_batch",
  "Perform MULTIPLE actions on an application in a single call. Much faster than calling app_action " +
    "repeatedly. Use this when you need to add multiple items, make several changes, or perform any " +
    "sequence of actions. Each action has a path, action name, and optional params.",
  {
    app: z.string().describe("App name or ID (from connected_apps)"),
    actions: z.string().describe("JSON array of actions, e.g. '[{\"path\":\"/\",\"action\":\"add\",\"params\":{\"title\":\"Item 1\"}},{\"path\":\"/\",\"action\":\"add\",\"params\":{\"title\":\"Item 2\"}}]'"),
  },
  async (args) =>
    handlers.appActionBatch({
      app: args.app,
      actions: JSON.parse(args.actions),
    }),
);

discovery.start();

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  discovery.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  discovery.stop();
  process.exit(0);
});
