import { Type } from "@sinclair/typebox";
import { formatTree, affordancesToTools } from "@slop/consumer";
import type { DiscoveryService } from "./discovery";

/**
 * Register application control tools with OpenClaw.
 *
 * Two tools:
 * - connected_apps: List apps or view a specific app's state and actions
 * - app_action: Perform an action on a connected application
 *
 * No mention of "SLOP" in tool names or descriptions — the protocol
 * is invisible to the agent and user.
 */
export function registerSlopTools(api: any, discovery: DiscoveryService) {
  // --- connected_apps ---
  api.registerTool({
    name: "connected_apps",
    description:
      "View applications running on this computer that you can observe and control. " +
      "Call without arguments to list all connected apps. " +
      "Call with an app name or ID to see its full current state and every action you can perform. " +
      "Examples of apps: task boards, note-taking apps, clipboard managers, timers, dev tools — " +
      "any desktop or web application that exposes its state.",
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App name or ID to get detailed state for. Omit to list all apps.",
        })
      ),
    }),
    async execute(_id: string, { app }: { app?: string }) {
      const providers = discovery.getProviders();

      if (providers.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No applications are currently connected. Desktop and web apps that support external control will appear here automatically when they're running.",
            },
          ],
        };
      }

      // If app specified, show detailed state
      if (app) {
        const p =
          discovery.getProvider(app) ??
          providers.find(
            (p) => p.name.toLowerCase().includes(app.toLowerCase()) || p.id.includes(app)
          ) ??
          null;

        if (!p) {
          const available = providers.map((p) => `${p.name} (${p.id})`).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `App "${app}" not found. Available apps: ${available}`,
              },
            ],
          };
        }

        const tree = p.consumer.getTree(p.subscriptionId);
        if (!tree) {
          return {
            content: [{ type: "text", text: `${p.name} is connected but has no state yet.` }],
          };
        }

        const tools = affordancesToTools(tree);
        const actionsText = tools
          .map((t) => {
            const parts = t.function.name.split("__");
            const action = parts[parts.length - 1];
            const path = "/" + parts.slice(1, -1).join("/");
            return `  - **${action}** on \`${path}\`: ${t.function.description}`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text:
                `## ${p.name}\nID: \`${p.id}\`\n\n` +
                `### Current State\n\`\`\`\n${formatTree(tree)}\n\`\`\`\n\n` +
                `### Available Actions (${tools.length})\n${actionsText}`,
            },
          ],
        };
      }

      // List all connected apps
      const lines = providers.map((p) => {
        const tree = p.consumer.getTree(p.subscriptionId);
        const actionCount = tree ? affordancesToTools(tree).length : 0;
        const label = tree?.properties?.label ?? p.name;
        const summary = tree?.meta?.summary ?? "";
        return `- **${label}** (id: \`${p.id}\`) — ${actionCount} actions available${summary ? `. ${summary}` : ""}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `Applications connected to this computer:\n${lines.join("\n")}\n\nUse connected_apps with an app name to see full state and available actions.`,
          },
        ],
      };
    },
  });

  // --- app_action ---
  api.registerTool({
    name: "app_action",
    description:
      "Perform an action on a connected application — add items, edit content, toggle state, " +
      "delete entries, move things around, start/stop processes, etc. " +
      "IMPORTANT: Always call connected_apps with the app name FIRST to see the exact state tree, " +
      "node paths, action names, and parameter values (like column IDs). " +
      "Do not guess parameter values — use the exact IDs and values shown in the state tree.",
    parameters: Type.Object({
      app: Type.String({
        description: "App name or ID (from connected_apps)",
      }),
      path: Type.String({
        description:
          "Path to the item to act on, e.g. '/' for the app root, '/todos/todo-1' for a specific item",
      }),
      action: Type.String({
        description:
          "Action to perform, e.g. 'add_card', 'toggle', 'delete', 'edit', 'move', 'start_pomodoro'",
      }),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Action parameters as key-value pairs, e.g. { title: 'New task', column: 'backlog' }",
        })
      ),
    }),
    async execute(
      _id: string,
      {
        app,
        path,
        action,
        params,
      }: {
        app: string;
        path: string;
        action: string;
        params?: Record<string, unknown>;
      }
    ) {
      const providers = discovery.getProviders();
      const p =
        discovery.getProvider(app) ??
        providers.find(
          (p) => p.name.toLowerCase().includes(app.toLowerCase()) || p.id.includes(app)
        ) ??
        null;

      if (!p) {
        return {
          content: [
            {
              type: "text",
              text: `App "${app}" not found or not connected. Use connected_apps to see available apps.`,
            },
          ],
        };
      }

      try {
        const result = await p.consumer.invoke(path, action, params ?? {});

        if (result.status === "ok") {
          // Wait briefly for state to update, then show current state
          await new Promise((r) => setTimeout(r, 150));
          const tree = p.consumer.getTree(p.subscriptionId);
          const statePreview = tree ? formatTree(tree) : "(state unavailable)";

          return {
            content: [
              {
                type: "text",
                text:
                  `Done. ${action} on ${path} succeeded.` +
                  (result.data ? ` Result: ${JSON.stringify(result.data)}` : "") +
                  `\n\nCurrent state:\n\`\`\`\n${statePreview}\n\`\`\``,
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
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err.message}`,
            },
          ],
        };
      }
    },
  });
}
