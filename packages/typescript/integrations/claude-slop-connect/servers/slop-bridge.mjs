#!/usr/bin/env node

/**
 * slop-bridge — MCP server that bridges SLOP providers to Claude.
 *
 * Uses the @slop-ai/discovery SDK for discovery, connection management,
 * bridge relay, and tool logic. Exposes:
 *
 * - Static tools: connected_apps (connect/list), app_action_batch (bulk ops)
 * - Dynamic tools: per-app affordance tools injected via MCP tools/list_changed
 *   when providers connect. The model calls e.g. `kanban__add_card({title: "..."})`
 *   directly — no proxy through app_action needed.
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
import { createToolHandlers, createDynamicTools } from "@slop-ai/discovery/claude";
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
// Dynamic tools — rebuilt on every state change
// ---------------------------------------------------------------------------

let dynamicToolSet = createDynamicTools(discovery);

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

// Update state file + dynamic tools whenever state changes
discovery.onStateChange(() => {
  const prevCount = dynamicToolSet.tools.length;
  dynamicToolSet = createDynamicTools(discovery);
  writeStateFile();

  // Notify Claude that the tool list changed (new/removed affordances)
  if (dynamicToolSet.tools.length !== prevCount) {
    server.sendToolListChanged().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Static MCP Tool definitions
// ---------------------------------------------------------------------------

const STATIC_TOOLS = [
  {
    name: "connected_apps",
    description:
      "Connect to an application to enable its tools, or list all available apps. " +
      "Once connected, per-app action tools appear automatically (e.g. kanban__add_card). " +
      "Call with an app name to connect; call without arguments to list all.",
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
    name: "app_action_batch",
    description:
      "Perform MULTIPLE actions on an application in a single call. Much faster than calling " +
      "individual action tools repeatedly. Use this when you need to add multiple items, " +
      "make several changes, or perform any sequence of actions.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID",
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
  { capabilities: { tools: { listChanged: true } } }
);

// --- List tools (static + dynamic) ---

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const dynamic = dynamicToolSet.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: "object",
      ...t.inputSchema,
    },
  }));

  return { tools: [...STATIC_TOOLS, ...dynamic] };
});

// --- Call tool ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    // Static tools
    switch (name) {
      case "connected_apps": {
        const result = await handlers.connectedApps(args);
        // After connecting a new app, rebuild dynamic tools
        dynamicToolSet = createDynamicTools(discovery);
        server.sendToolListChanged().catch(() => {});
        return result;
      }

      case "app_action_batch":
        return await handlers.appActionBatch(args);
    }

    // Dynamic tools — resolve to provider invoke
    const resolved = dynamicToolSet.resolve(name);
    if (resolved) {
      const provider = discovery.getProvider(resolved.providerId);
      if (!provider) {
        return {
          content: [{ type: "text", text: `App disconnected. Call connected_apps to reconnect.` }],
          isError: true,
        };
      }

      try {
        const result = await provider.consumer.invoke(
          resolved.path,
          resolved.action,
          args ?? {},
        );

        if (result.status === "ok") {
          return {
            content: [{
              type: "text",
              text: `Done.` + (result.data ? ` Result: ${JSON.stringify(result.data)}` : ""),
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

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
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
