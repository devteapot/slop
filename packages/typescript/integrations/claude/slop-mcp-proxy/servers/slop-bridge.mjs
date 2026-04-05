#!/usr/bin/env node

/**
 * slop-bridge (mcp-proxy) — MCP server that bridges SLOP providers to Claude.
 *
 * Five static tools:
 *   - list_apps: list available SLOP providers
 *   - connect_app: explicitly connect to a SLOP provider
 *   - disconnect_app: explicitly disconnect from a provider
 *   - app_action: perform a single action on an app node
 *   - app_action_batch: perform multiple actions in one call
 *
 * No dynamic per-affordance tools. The model reads affordance info from
 * injected context (via the UserPromptSubmit hook) and uses the generic
 * app_action tool to invoke them.
 *
 * State is written to a shared file for the context-injection hook.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createDiscoveryService } from "@slop-ai/discovery";
import { createToolHandlers } from "@slop-ai/discovery";
import { formatTree } from "@slop-ai/consumer";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR = "/tmp/claude-slop-plugin";
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

const discovery = createDiscoveryService({ logger: log, autoConnect: false });
const handlers = createToolHandlers(discovery);

// ---------------------------------------------------------------------------
// State file management (for hook-based context injection)
// ---------------------------------------------------------------------------

function writeStateFile() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });

    const connected = discovery.getProviders();
    const discovered = discovery.getDiscovered();
    const connectedIds = new Set(connected.map((p) => p.id));

    // Discovered but not connected
    const available = discovered
      .filter((d) => !connectedIds.has(d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        transport: d.transport.type,
        source: d.source ?? "local",
      }));

    if (connected.length === 0 && available.length === 0) {
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

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ lastUpdated: Date.now(), providers, available }, null, 2),
    );
  } catch (err) {
    log.error("Failed to write state file:", err.message);
  }
}

// Update state file whenever state changes
discovery.onStateChange(() => {
  writeStateFile();
});

// ---------------------------------------------------------------------------
// Static MCP Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_apps",
    description:
      "List all available applications for connection. " +
      "Shows which apps are already connected and how many actions they expose.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "connect_app",
    description:
      "Connect to an application to see its state and actions. " +
      "Once connected, the app's state tree is injected into context automatically on every message.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description:
            "App name or ID to connect. Omit to list all apps.",
        },
      },
    },
  },
  {
    name: "disconnect_app",
    description:
      "Disconnect from an application. Stops state updates and removes it from context. " +
      "Use when you're done interacting with an app.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID to disconnect from.",
        },
      },
      required: ["app"],
    },
  },
  {
    name: "app_action",
    description:
      "Perform an action on an application — add items, edit content, toggle state, " +
      "delete entries, move things around, start/stop processes, etc. " +
      "Use the exact paths, action names, and parameter values from the application state shown in context.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID (from connect_app or context)",
        },
        path: {
          type: "string",
          description: "Path to the item to act on, e.g. '/' for root, '/todos/todo-1'",
        },
        action: {
          type: "string",
          description: "Action to perform, e.g. 'add_card', 'toggle', 'delete'",
        },
        params: {
          type: "object",
          description: "Action parameters as key-value pairs (optional)",
          additionalProperties: true,
        },
      },
      required: ["app", "path", "action"],
    },
  },
  {
    name: "app_action_batch",
    description:
      "Perform MULTIPLE actions on an application in a single call. Much faster than calling " +
      "app_action repeatedly. Use this when you need to add multiple items, make several changes, " +
      "or perform any sequence of actions.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID (from connect_app or context)",
        },
        actions: {
          type: "array",
          description: "Array of actions to perform sequentially",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to act on" },
              action: { type: "string", description: "Action to perform" },
              params: {
                type: "object",
                description: "Action parameters",
                additionalProperties: true,
              },
            },
            required: ["path", "action"],
          },
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

// --- List tools (static only) ---

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// --- Call tool ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "list_apps":
        return await handlers.listApps();

      case "connect_app":
        return await handlers.connectApp(args);

      case "disconnect_app":
        return await handlers.disconnectApp(args);

      case "app_action": {
        const p = await discovery.ensureConnected(args.app);
        if (!p) {
          return {
            content: [{ type: "text", text: `App "${args.app}" not found or could not connect.` }],
            isError: true,
          };
        }
        try {
          const result = await p.consumer.invoke(
            args.path,
            args.action,
            args.params ?? {},
          );
          if (result.status === "ok") {
            return {
              content: [{
                type: "text",
                text: `Done. ${args.action} on ${args.path} succeeded.` +
                  (result.data ? ` Result: ${JSON.stringify(result.data)}` : ""),
              }],
            };
          }
          return {
            content: [{
              type: "text",
              text: `Action failed: [${result.error?.code}] ${result.error?.message}`,
            }],
            isError: true,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      }

      case "app_action_batch": {
        const p = await discovery.ensureConnected(args.app);
        if (!p) {
          return {
            content: [{ type: "text", text: `App "${args.app}" not found or could not connect.` }],
            isError: true,
          };
        }
        const results = [];
        let failed = 0;
        for (const { path: actionPath, action, params } of args.actions) {
          try {
            const result = await p.consumer.invoke(actionPath, action, params ?? {});
            if (result.status === "ok") {
              results.push(`OK: ${action} on ${actionPath}`);
            } else {
              failed++;
              results.push(`FAIL: ${action} on ${actionPath} — [${result.error?.code}] ${result.error?.message}`);
            }
          } catch (err) {
            failed++;
            results.push(`ERROR: ${action} on ${actionPath} — ${err.message}`);
          }
        }
        return {
          content: [{
            type: "text",
            text: `Batch complete: ${args.actions.length - failed}/${args.actions.length} succeeded.\n` +
              results.join("\n"),
          }],
          isError: failed > 0,
        };
      }

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
  discovery.start();
  log.info("Discovery started (local + bridge)");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server running on stdio");

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
