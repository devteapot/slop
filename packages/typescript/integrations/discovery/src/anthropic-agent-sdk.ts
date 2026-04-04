/**
 * Optional helpers for `@anthropic-ai/claude-agent-sdk` (`tool()`, `createSdkMcpServer`).
 *
 * Use when wiring SLOP discovery into Anthropic Agent `query()` or MCP-from-SDK flows.
 * Host-agnostic tool logic (`createToolHandlers`, `createDynamicTools`, discovery, bridge)
 * is exported from `@slop-ai/discovery` — not from this entry point.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createDiscoveryService } from "./discovery";
import { createToolHandlers } from "./tools";

/**
 * Create Agent SDK tool definitions for use with `query()`.
 */
export function createSlopAgentTools(discovery: ReturnType<typeof createDiscoveryService>) {
  const handlers = createToolHandlers(discovery);

  const connectedApps = tool(
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

  const appAction = tool(
    "app_action",
    "Perform an action on an application — add items, edit content, toggle state, " +
      "delete entries, move things around, start/stop processes, etc. " +
      "IMPORTANT: Always call connected_apps with the app name FIRST to see the exact state tree, " +
      "node paths, action names, and parameter values. Do not guess — use the exact IDs shown.",
    {
      app: z.string().describe("App name or ID (from connected_apps)"),
      path: z.string().describe("Path to the item to act on, e.g. '/' for root, '/todos/todo-1'"),
      action: z.string().describe("Action to perform, e.g. 'add_card', 'toggle', 'delete'"),
      params: z.record(z.unknown()).optional().describe("Action parameters as key-value pairs"),
    },
    async (args) => handlers.appAction({ ...args, params: args.params as Record<string, unknown> | undefined }),
  );

  const appActionBatch = tool(
    "app_action_batch",
    "Perform MULTIPLE actions on an application in a single call. Much faster than calling app_action " +
      "repeatedly. Use this when you need to add multiple items, make several changes, or perform any " +
      "sequence of actions.",
    {
      app: z.string().describe("App name or ID (from connected_apps)"),
      actions: z.array(z.object({
        path: z.string().describe("Path to act on"),
        action: z.string().describe("Action to perform"),
        params: z.record(z.unknown()).optional().describe("Action parameters"),
      })).describe("Array of actions to perform sequentially"),
    },
    async (args) => handlers.appActionBatch({
      app: args.app,
      actions: args.actions.map(a => ({ ...a, params: a.params as Record<string, unknown> | undefined })),
    }),
  );

  return [connectedApps, appAction, appActionBatch];
}

/**
 * Create an MCP server config for use with Agent SDK's `query()`.
 *
 * Programmatic use: pass `server` to `query()` via `mcpServers`.
 */
export function createSlopMcpServer(options?: {
  name?: string;
  version?: string;
}) {
  const discovery = createDiscoveryService();
  discovery.start();

  const tools = createSlopAgentTools(discovery);

  const server = createSdkMcpServer({
    name: options?.name ?? "slop",
    version: options?.version ?? "1.0.0",
    tools,
  });

  return { server, discovery };
}
