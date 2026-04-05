#!/usr/bin/env node

/**
 * slop-bridge — fixed-tool MCP server for the Codex plugin.
 *
 * Codex keeps a stable five-tool surface, but connected providers' state is also
 * written to a shared file for UserPromptSubmit hook-based context injection.
 * connect_app still returns an immediate snapshot so Codex can act in the same
 * turn it establishes a new connection.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createDiscoveryService, createToolHandlers } from "@slop-ai/discovery";
import { formatTree } from "@slop-ai/consumer";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = "/tmp/codex-slop-plugin";
const STATE_FILE = path.join(STATE_DIR, "state.json");

const log = {
  info: (...args) => console.error("[codex-slop]", ...args),
  error: (...args) => console.error("[codex-slop] ERROR:", ...args),
};

const discovery = createDiscoveryService({ logger: log, autoConnect: false });
const handlers = createToolHandlers(discovery);

function writeStateFile() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });

    const connected = discovery.getProviders();
    const discovered = discovery.getDiscovered();
    const connectedIds = new Set(connected.map((provider) => provider.id));

    const available = discovered
      .filter((descriptor) => !connectedIds.has(descriptor.id))
      .map((descriptor) => ({
        id: descriptor.id,
        name: descriptor.name,
        transport: descriptor.transport.type,
        source: descriptor.source ?? "local",
      }));

    if (connected.length === 0 && available.length === 0) {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      return;
    }

    const providers = connected.map((provider) => {
      const tree = provider.consumer.getTree(provider.subscriptionId);
      return {
        id: provider.id,
        name: provider.name,
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

discovery.onStateChange(() => {
  writeStateFile();
});

const TOOLS = [
  {
    name: "list_apps",
    description:
      "List SLOP-enabled applications currently available on this computer and whether they are already connected.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "connect_app",
    description:
      "Connect to an application and return its current state tree and available actions. " +
      "Once connected, future user messages also receive the app's live state through Codex hook-based context injection.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID to connect and inspect.",
        },
      },
      required: ["app"],
    },
  },
  {
    name: "disconnect_app",
    description:
      "Disconnect from an application when you're done interacting with it.",
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
      "Perform a single affordance on an application. Use the exact path, action, and parameter names shown by connect_app or in the injected SLOP Apps context.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID.",
        },
        path: {
          type: "string",
          description: "Path to the node to act on, for example '/' or '/todos/todo-1'.",
        },
        action: {
          type: "string",
          description: "Action to perform, for example 'add_card', 'toggle', or 'delete'.",
        },
        params: {
          type: "object",
          description: "Optional action parameters.",
          additionalProperties: true,
        },
      },
      required: ["app", "path", "action"],
    },
  },
  {
    name: "app_action_batch",
    description:
      "Perform multiple affordances on an application in one call. Prefer this for repeated or bulk operations, using the exact paths and action names from connect_app or injected context.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "App name or ID.",
        },
        actions: {
          type: "array",
          description: "Actions to perform sequentially.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the node to act on.",
              },
              action: {
                type: "string",
                description: "Action name.",
              },
              params: {
                type: "object",
                description: "Optional action parameters.",
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

const server = new Server(
  { name: "slop-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
        const provider = await discovery.ensureConnected(args.app);
        if (!provider) {
          return {
            content: [{ type: "text", text: `App "${args.app}" not found or could not connect.` }],
            isError: true,
          };
        }

        try {
          const result = await provider.consumer.invoke(
            args.path,
            args.action,
            args.params ?? {},
          );

          if (result.status === "ok") {
            return {
              content: [{
                type: "text",
                text:
                  `Done. ${args.action} on ${args.path} succeeded.` +
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
        const provider = await discovery.ensureConnected(args.app);
        if (!provider) {
          return {
            content: [{ type: "text", text: `App "${args.app}" not found or could not connect.` }],
            isError: true,
          };
        }

        const results = [];
        let failed = 0;

        for (const { path, action, params } of args.actions) {
          try {
            const result = await provider.consumer.invoke(path, action, params ?? {});
            if (result.status === "ok") {
              results.push(`OK: ${action} on ${path}`);
            } else {
              failed++;
              results.push(`FAIL: ${action} on ${path} — [${result.error?.code}] ${result.error?.message}`);
            }
          } catch (err) {
            failed++;
            results.push(`ERROR: ${action} on ${path} — ${err.message}`);
          }
        }

        return {
          content: [{
            type: "text",
            text:
              `Batch complete: ${args.actions.length - failed}/${args.actions.length} succeeded.\n` +
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

async function main() {
  discovery.start();
  log.info("Discovery started (local + bridge)");
  writeStateFile();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server running on stdio");

  process.on("SIGINT", () => {
    discovery.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    discovery.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
