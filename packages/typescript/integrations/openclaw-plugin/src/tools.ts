import { Type } from "@sinclair/typebox";
import type { DiscoveryService } from "@slop-ai/discovery";
import type { ToolResult } from "@slop-ai/discovery";

interface ToolHandlers {
  discoverApps(): Promise<ToolResult>;
  connectApp(args: { app: string }): Promise<ToolResult>;
  disconnectApp(args: { app: string }): Promise<ToolResult>;
}

export function registerSlopTools(api: any, discovery: DiscoveryService, handlers: ToolHandlers) {
  api.registerTool({
    name: "discover_apps",
    description:
      "List the applications currently discoverable on this computer and whether they are already connected.",
    parameters: Type.Object({}),
    async execute(_id: string) {
      return handlers.discoverApps();
    },
  });

  api.registerTool({
    name: "connect_app",
    description:
      "Connect to an application and see its full state tree and every action you can perform. " +
      "State for already-connected apps is injected into context automatically — " +
      "use this to connect a new app or refresh detailed state.",
    parameters: Type.Object({
      app: Type.String({
        description: "App name or ID to connect and inspect.",
      }),
    }),
    async execute(_id: string, args: { app: string }) {
      return handlers.connectApp(args);
    },
  });

  api.registerTool({
    name: "disconnect_app",
    description:
      "Disconnect from an application. Stops state updates. " +
      "Use when you're done interacting with an app.",
    parameters: Type.Object({
      app: Type.String({
        description: "App name or ID to disconnect from.",
      }),
    }),
    async execute(_id: string, args: { app: string }) {
      return handlers.disconnectApp(args);
    },
  });

  api.registerTool({
    name: "app_action",
    description:
      "Perform an action on an application — add items, edit content, toggle state, " +
      "delete entries, move things around, start/stop processes, etc. " +
      "Use the exact paths, action names, and parameter values from the application state shown in context.",
    parameters: Type.Object({
      app: Type.String({
        description: "App name or ID (from connect_app or context)",
      }),
      path: Type.String({
        description: "Path to the item to act on, e.g. '/' for root, '/todos/todo-1'",
      }),
      action: Type.String({
        description: "Action to perform, e.g. 'add_card', 'toggle', 'delete'",
      }),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Action parameters as key-value pairs",
        }),
      ),
    }),
    async execute(
      _id: string,
      args: { app: string; path: string; action: string; params?: Record<string, unknown> },
    ) {
      const p = await discovery.ensureConnected(args.app);
      if (!p) {
        return {
          content: [{ type: "text" as const, text: `App "${args.app}" not found or could not connect.` }],
          isError: true,
        };
      }
      try {
        const result = await p.consumer.invoke(args.path, args.action, args.params ?? {});
        if (result.status === "ok") {
          return {
            content: [{
              type: "text" as const,
              text: `Done. ${args.action} on ${args.path} succeeded.` +
                (result.data ? ` Result: ${JSON.stringify(result.data)}` : ""),
            }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Action failed: [${result.error?.code}] ${result.error?.message}`,
          }],
          isError: true,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  });

  api.registerTool({
    name: "app_action_batch",
    description:
      "Perform MULTIPLE actions on an application in a single call. Much faster than calling app_action " +
      "repeatedly. Use this when you need to add multiple items, make several changes, or perform any " +
      "sequence of actions.",
    parameters: Type.Object({
      app: Type.String({
        description: "App name or ID (from connect_app or context)",
      }),
      actions: Type.Array(
        Type.Object({
          path: Type.String({ description: "Path to act on" }),
          action: Type.String({ description: "Action to perform" }),
          params: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description: "Action parameters",
            }),
          ),
        }),
        { description: "Array of actions to perform sequentially" },
      ),
    }),
    async execute(
      _id: string,
      args: { app: string; actions: { path: string; action: string; params?: Record<string, unknown> }[] },
    ) {
      const p = await discovery.ensureConnected(args.app);
      if (!p) {
        return {
          content: [{ type: "text" as const, text: `App "${args.app}" not found or could not connect.` }],
          isError: true,
        };
      }
      const results: string[] = [];
      let failed = 0;
      for (const { path, action, params } of args.actions) {
        try {
          const result = await p.consumer.invoke(path, action, params ?? {});
          if (result.status === "ok") {
            results.push(`OK: ${action} on ${path}`);
          } else {
            failed++;
            results.push(`FAIL: ${action} on ${path} — [${result.error?.code}] ${result.error?.message}`);
          }
        } catch (err: any) {
          failed++;
          results.push(`ERROR: ${action} on ${path} — ${err.message}`);
        }
      }
      return {
        content: [{
          type: "text" as const,
          text: `Batch complete: ${args.actions.length - failed}/${args.actions.length} succeeded.\n` +
            results.join("\n"),
        }],
        isError: failed > 0,
      };
    },
  });
}
