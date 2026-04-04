#!/usr/bin/env node

/**
 * slop-bridge — MCP server that bridges SLOP providers to Claude.
 *
 * Uses the @slop-ai/claude-agent SDK for discovery, connection management,
 * bridge relay, and tool logic. This file is a thin MCP wrapper that exposes
 * the SDK's tools (connected_apps, app_action, app_action_batch) as MCP tools
 * and writes state to a shared file for the context-injection hook.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createDiscoveryService, createToolHandlers } from "@slop-ai/claude-agent";
import { formatTree } from "@slop-ai/consumer";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR = "/tmp/claude-slop-connect";
const STATE_FILE = path.join(STATE_DIR, "state.json");

// ---------------------------------------------------------------------------
// Logger (MCP servers must not write to stdout — use stderr)
// ---------------------------------------------------------------------------

const log = {
  info: (...args) => console.error("[slop-bridge]", ...args),
  error: (...args) => console.error("[slop-bridge] ERROR:", ...args),
};

// ---------------------------------------------------------------------------
// Discovery service (from SDK — handles local + bridge + relay)
// ---------------------------------------------------------------------------

const discovery = createDiscoveryService({ logger: log, autoConnect: false, hostBridge: false });
const handlers = createToolHandlers(discovery);

// ---------------------------------------------------------------------------
// State file management (for hook-based context injection)
// ---------------------------------------------------------------------------

function writeStateFile() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });

    const connected = discovery.getProviders();
    if (connected.length === 0) {
      // Clean up state file when nothing is connected
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      return;
    }

    const providers = connected.map((p) => {
      const tree = p.consumer.getTree(p.subscriptionId);
      return {
        id: p.id,
        name: p.name,
        state: tree ? formatTree(tree) : "(no state yet)",
      };
    });

    fs.writeFileSync(STATE_FILE, JSON.stringify({ providers }, null, 2));
  } catch (err) {
    log.error("Failed to write state file:", err.message);
  }
}

// Update state file whenever state changes (connect, disconnect, patch)
discovery.onStateChange(() => {
  writeStateFile();
});

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "connected_apps",
    description:
      "View applications running on this computer that you can observe and control. " +
      "Call without arguments to list all available apps. " +
      "Call with an app name or ID to connect (if needed) and see its full current state and every action you can perform.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description:
            "App name or ID to get detailed state for. Omit to list all apps.",
        },
      },
    },
  },
  {
    name: "app_action",
    description:
      "Perform an action on an application — add items, edit content, toggle state, " +
      "delete entries, move things around, start/stop processes, etc. " +
      "IMPORTANT: Always call connected_apps with the app name FIRST to see the exact state tree, " +
      "node paths, action names, and parameter values. Do not guess — use the exact IDs shown.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID (from connected_apps)",
        },
        path: {
          type: "string",
          description:
            "Path to the item to act on, e.g. '/' for root, '/todos/todo-1'",
        },
        action: {
          type: "string",
          description: "Action to perform, e.g. 'add_card', 'toggle', 'delete'",
        },
        params: {
          type: "object",
          description: "Action parameters as key-value pairs",
        },
      },
      required: ["app", "path", "action"],
    },
  },
  {
    name: "app_action_batch",
    description:
      "Perform MULTIPLE actions on an application in a single call. Much faster than calling app_action " +
      "repeatedly. Use this when you need to add multiple items, make several changes, or perform any " +
      "sequence of actions.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID (from connected_apps)",
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to act on" },
              action: { type: "string", description: "Action to perform" },
              params: {
                type: "object",
                description: "Action parameters",
              },
            },
            required: ["path", "action"],
          },
          description: "Array of actions to perform sequentially",
        },
      },
      required: ["app", "actions"],
    },
  },
];

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "slop-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// --- List tools ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// --- Call tool ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "connected_apps":
        return await handlers.connectedApps(args);

      case "app_action":
        return await handlers.appAction(args);

      case "app_action_batch":
        return await handlers.appActionBatch(args);

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  // Start discovery (local filesystem + bridge client)
  discovery.start();
  log.info("Discovery started (local + bridge)");

  // Connect MCP over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server running on stdio");

  // Cleanup on exit
  process.on("SIGINT", () => {
    discovery.stop();
    try { fs.unlinkSync(STATE_FILE); } catch {}
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    discovery.stop();
    try { fs.unlinkSync(STATE_FILE); } catch {}
    process.exit(0);
  });
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
