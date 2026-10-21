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
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildSlopContext } from "@slop-ai/discovery/context";
import { createDiscoveryService } from "@slop-ai/discovery/service";
import { createToolHandlers } from "@slop-ai/discovery/tools";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = "/tmp/codex-slop-plugin";
const CONTEXT_FILE = path.join(STATE_DIR, "context.txt");
const LEGACY_STATE_FILE = path.join(STATE_DIR, "state.json");

const log = {
  info: (...args) => console.error("[codex-slop]", ...args),
  error: (...args) => console.error("[codex-slop] ERROR:", ...args),
};

const discovery = createDiscoveryService({ logger: log, autoConnect: false });
const handlers = createToolHandlers(discovery);

function writeContextFile() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });

    // Drop the legacy JSON state file the first time we run with the new layout.
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

discovery.onStateChange(() => {
  writeContextFile();
});

// Heartbeat: re-render the context file periodically while we're alive. This
// keeps `generated_at` honest and lets the hook's stale-detection signal
// "bridge died", not "state hasn't changed recently". Re-rendering (not just
// touching mtime) avoids the model seeing an old timestamp on unchanged state.
// The tail is uncached by design, so refreshing its bytes is harmless.
const HEARTBEAT_INTERVAL_MS = 10_000;
const heartbeatTimer = setInterval(() => {
  writeContextFile();
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref?.();

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
    description: "Disconnect from an application when you're done interacting with it.",
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

const server = new Server({ name: "slop-bridge", version: "0.1.0" }, { capabilities: { tools: {} } });

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
          const result = await provider.consumer.invoke(args.path, args.action, args.params ?? {});

          if (result.status === "ok") {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `Done. ${args.action} on ${args.path} succeeded.` +
                    (result.data ? ` Result: ${JSON.stringify(result.data)}` : ""),
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
          content: [
            {
              type: "text",
              text:
                `Batch complete: ${args.actions.length - failed}/${args.actions.length} succeeded.\n` +
                results.join("\n"),
            },
          ],
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
  writeContextFile();

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
