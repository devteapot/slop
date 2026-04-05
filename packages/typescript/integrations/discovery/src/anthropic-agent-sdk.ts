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
 *
 * Returns lifecycle tools only (list_apps, connect_app, disconnect_app).
 * Dynamic affordance tools should be wired via MCP's tools/list_changed
 * using `createDynamicTools()` from the main export.
 */
export function createSlopAgentTools(discovery: ReturnType<typeof createDiscoveryService>) {
  const handlers = createToolHandlers(discovery);

  const listApps = tool(
    "list_apps",
    "View applications running on this computer that you can observe and control. " +
      "Lists all available apps and shows which ones are already connected.",
    {},
    async () => handlers.listApps(),
  );

  const connectApp = tool(
    "connect_app",
    "Connect to an application running on this computer and see its full current state and every action you can perform.",
    {
      app: z
        .string()
        .describe("App name or ID to connect and inspect."),
    },
    async (args) => handlers.connectApp(args),
  );

  const disconnectApp = tool(
    "disconnect_app",
    "Disconnect from an application. Removes its action tools and stops state updates. " +
      "Use when you're done interacting with an app.",
    {
      app: z.string().describe("App name or ID to disconnect from."),
    },
    async (args) => handlers.disconnectApp(args),
  );

  return [listApps, connectApp, disconnectApp];
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
