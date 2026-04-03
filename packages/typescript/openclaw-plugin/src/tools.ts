import { Type } from "@sinclair/typebox";
import { formatTree, affordancesToTools } from "@slop-ai/consumer";
import type { DiscoveryService } from "./discovery";

export function registerSlopTools(api: any, discovery: DiscoveryService) {
  // --- connected_apps ---
  api.registerTool({
    name: "connected_apps",
    description:
      "View applications running on this computer that you can observe and control. " +
      "Call without arguments to list all available apps. " +
      "Call with an app name or ID to connect (if needed) and see its full current state and every action you can perform.",
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App name or ID to get detailed state for. Omit to list all apps.",
        })
      ),
    }),
    async execute(_id: string, { app }: { app?: string }) {
      // --- List all discovered apps ---
      if (!app) {
        const discovered = discovery.getDiscovered();
        if (discovered.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No applications found. Desktop and web apps that support external control will appear here automatically when they're running.",
            }],
          };
        }

        const connected = discovery.getProviders();
        const connectedIds = new Set(connected.map(p => p.id));

        const lines = discovered.map(desc => {
          const isConnected = connectedIds.has(desc.id);
          const provider = isConnected ? connected.find(p => p.id === desc.id) : null;
          const tree = provider?.consumer.getTree(provider.subscriptionId);
          const actionCount = tree ? affordancesToTools(tree).tools.length : 0;
          const label = tree?.properties?.label ?? desc.name;
          const status = isConnected ? `connected, ${actionCount} actions` : "available";
          return `- **${label}** (id: \`${desc.id}\`, ${desc.transport.type}) — ${status}`;
        });

        return {
          content: [{
            type: "text",
            text: `Applications on this computer:\n${lines.join("\n")}\n\nUse connected_apps with an app name to see full state and available actions.`,
          }],
        };
      }

      // --- Show specific app (lazy connect) ---
      const p = await discovery.ensureConnected(app);
      if (!p) {
        const discovered = discovery.getDiscovered();
        const available = discovered.map(d => `${d.name} (${d.id})`).join(", ");
        return {
          content: [{
            type: "text",
            text: `App "${app}" not found. Available: ${available || "none"}`,
          }],
        };
      }

      const tree = p.consumer.getTree(p.subscriptionId);
      if (!tree) {
        return {
          content: [{ type: "text", text: `${p.name} is connected but has no state yet.` }],
        };
      }

      const toolSet = affordancesToTools(tree);
      const actionsText = toolSet.tools
        .map(t => {
          const resolved = toolSet.resolve(t.function.name);
          const action = resolved?.action ?? t.function.name;
          const path = resolved?.path ?? "/";
          return `  - **${action}** on \`${path}\`: ${t.function.description}`;
        })
        .join("\n");

      return {
        content: [{
          type: "text",
          text:
            `## ${p.name}\nID: \`${p.id}\`\n\n` +
            `### Current State\n\`\`\`\n${formatTree(tree)}\n\`\`\`\n\n` +
            `### Available Actions (${toolSet.tools.length})\n${actionsText}`,
        }],
      };
    },
  });

  // --- app_action ---
  api.registerTool({
    name: "app_action",
    description:
      "Perform an action on an application — add items, edit content, toggle state, " +
      "delete entries, move things around, start/stop processes, etc. " +
      "IMPORTANT: Always call connected_apps with the app name FIRST to see the exact state tree, " +
      "node paths, action names, and parameter values. Do not guess — use the exact IDs shown.",
    parameters: Type.Object({
      app: Type.String({
        description: "App name or ID (from connected_apps)",
      }),
      path: Type.String({
        description: "Path to the item to act on, e.g. '/' for root, '/todos/todo-1' for a specific item",
      }),
      action: Type.String({
        description: "Action to perform, e.g. 'add_card', 'toggle', 'delete', 'edit', 'move'",
      }),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Action parameters as key-value pairs, e.g. { title: 'New task', column: 'backlog' }",
        })
      ),
    }),
    async execute(
      _id: string,
      { app, path, action, params }: { app: string; path: string; action: string; params?: Record<string, unknown> }
    ) {
      const p = await discovery.ensureConnected(app);
      if (!p) {
        return {
          content: [{
            type: "text",
            text: `App "${app}" not found or could not connect. Use connected_apps to see available apps.`,
          }],
        };
      }

      try {
        const result = await p.consumer.invoke(path, action, params ?? {});

        if (result.status === "ok") {
          await new Promise(r => setTimeout(r, 150));
          const tree = p.consumer.getTree(p.subscriptionId);
          const statePreview = tree ? formatTree(tree) : "(state unavailable)";

          return {
            content: [{
              type: "text",
              text:
                `Done. ${action} on ${path} succeeded.` +
                (result.data ? ` Result: ${JSON.stringify(result.data)}` : "") +
                `\n\nCurrent state:\n\`\`\`\n${statePreview}\n\`\`\``,
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: `Action failed: [${result.error?.code}] ${result.error?.message}`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
        };
      }
    },
  });
}
