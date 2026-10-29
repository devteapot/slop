#!/usr/bin/env node

/**
 * slop-bridge — MCP server that bridges SLOP providers to Claude.
 *
 * Three lifecycle tools:
 *   - list_apps: list available SLOP providers
 *   - connect_app: explicitly connect to a SLOP provider
 *   - disconnect_app: explicitly disconnect from a provider
 *
 * All app actions are exposed as dynamic per-app tools via MCP tools/list_changed.
 * When a provider connects, its affordances become first-class tools
 * (e.g. `excalidraw__elements__add_rectangle`). The model calls them directly.
 *
 * State is written to a shared file for the context-injection hook.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildSlopContext } from "@slop-ai/discovery/context";
import { createDiscoveryService } from "@slop-ai/discovery/service";
import { createToolHandlers, createDynamicTools } from "@slop-ai/discovery/tools";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR = "/tmp/claude-slop-plugin";
const CONTEXT_FILE = path.join(STATE_DIR, "context.txt");
const LEGACY_STATE_FILE = path.join(STATE_DIR, "state.json");

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
// Dynamic tools — rebuilt on every state change
// ---------------------------------------------------------------------------

let dynamicToolSet = createDynamicTools(discovery);

// ---------------------------------------------------------------------------
// State file management (for hook-based context injection)
// ---------------------------------------------------------------------------

function writeContextFile() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });

    if (fs.existsSync(LEGACY_STATE_FILE)) {
      try {
        fs.unlinkSync(LEGACY_STATE_FILE);
      } catch {}
    }

    const { stateTail, availableAppsTail } = buildSlopContext(discovery);
    const parts = [stateTail, availableAppsTail].filter((t) => !!t);

    if (parts.length === 0) {
      if (fs.existsSync(CONTEXT_FILE)) fs.unlinkSync(CONTEXT_FILE);
      return;
    }

    fs.writeFileSync(CONTEXT_FILE, parts.join("\n\n"));
  } catch (err) {
    log.error("Failed to write context file:", err.message);
  }
}

// Heartbeat: re-render the context file periodically while we're alive so
// `generated_at` refreshes and the hook's stale-detection signals "bridge
// died", not "state hasn't changed recently". The tail is uncached by design.
const HEARTBEAT_INTERVAL_MS = 10_000;
const heartbeatTimer = setInterval(() => {
  writeContextFile();
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref?.();

// Update state file + dynamic tools whenever state changes
discovery.onStateChange(() => {
  const prevCount = dynamicToolSet.tools.length;
  dynamicToolSet = createDynamicTools(discovery);
  writeContextFile();

  // Notify Claude that the tool list changed (new/removed affordances)
  if (dynamicToolSet.tools.length !== prevCount) {
    server.sendToolListChanged().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Static MCP Tool definitions (lifecycle only)
// ---------------------------------------------------------------------------

const STATIC_TOOLS = [
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
      "Connect to an application to enable its tools and inspect its current state. " +
      "Once connected, per-app action tools appear automatically (e.g. kanban__add_card).",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID to connect. Omit to list all apps.",
        },
      },
    },
  },
  {
    name: "disconnect_app",
    description:
      "Disconnect from an application. Removes its action tools and stops state updates. " +
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
];

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "slop-bridge", version: "0.1.0" },
  { capabilities: { tools: { listChanged: true } } },
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
      case "list_apps": {
        return await handlers.listApps();
      }

      case "connect_app": {
        const result = await handlers.connectApp(args);
        // After connecting a new app, rebuild dynamic tools
        dynamicToolSet = createDynamicTools(discovery);
        server.sendToolListChanged().catch(() => {});
        return result;
      }

      case "disconnect_app": {
        const result = await handlers.disconnectApp(args);
        // After disconnecting, rebuild dynamic tools (removes app's tools)
        dynamicToolSet = createDynamicTools(discovery);
        server.sendToolListChanged().catch(() => {});
        return result;
      }
    }

    // Dynamic tools — resolve to provider invoke
    const resolved = dynamicToolSet.resolve(name);
    if (resolved) {
      const provider = discovery.getProvider(resolved.providerId);
      if (!provider) {
        return {
          content: [{ type: "text", text: `App disconnected. Call connect_app to reconnect.` }],
          isError: true,
        };
      }

      // For grouped tools (path === null), extract `target` from args
      let invokePath = resolved.path;
      let invokeArgs = args ?? {};

      if (invokePath === null) {
        const { target, ...rest } = invokeArgs;
        if (!target || typeof target !== "string") {
          return {
            content: [
              {
                type: "text",
                text: `Missing required "target" parameter. Specify the path to the target node (see state tree for valid paths).`,
              },
            ],
            isError: true,
          };
        }
        if (resolved.targets && !resolved.targets.includes(target)) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid target "${target}". Valid targets: ${resolved.targets.join(", ")}. Check the state tree for current paths.`,
              },
            ],
            isError: true,
          };
        }
        invokePath = target;
        invokeArgs = rest;
      }

      try {
        const result = await provider.consumer.invoke(invokePath, resolved.action, invokeArgs);

        if (result.status === "ok") {
          return {
            content: [
              {
                type: "text",
                text: `Done.` + (result.data ? ` Result: ${JSON.stringify(result.data)}` : ""),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Action failed: [${result.error?.code}] ${result.error?.message}`,
            },
          ],
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
    try {
      fs.unlinkSync(CONTEXT_FILE);
    } catch {}
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    discovery.stop();
    try {
      fs.unlinkSync(CONTEXT_FILE);
    } catch {}
    process.exit(0);
  });
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
