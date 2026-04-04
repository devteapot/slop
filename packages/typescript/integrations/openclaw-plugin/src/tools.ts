import { Type } from "@sinclair/typebox";
import type { DiscoveryService } from "@slop-ai/discovery";
import type { ToolResult } from "@slop-ai/discovery/claude";

interface ToolHandlers {
  connectedApps(args: { app?: string }): Promise<ToolResult>;
  appAction(args: { app: string; path: string; action: string; params?: Record<string, unknown> }): Promise<ToolResult>;
  appActionBatch(args: { app: string; actions: { path: string; action: string; params?: Record<string, unknown> }[] }): Promise<ToolResult>;
}

export function registerSlopTools(api: any, discovery: DiscoveryService, handlers: ToolHandlers) {
  api.registerTool({
    name: "connected_apps",
    description:
      "Connect to an application and see its full state tree and every action you can perform. " +
      "State for already-connected apps is injected into context automatically — " +
      "use this only to connect new apps or refresh state.",
    parameters: Type.Object({
      app: Type.Optional(
        Type.String({
          description: "App name or ID to connect and inspect. Omit to list all apps.",
        }),
      ),
    }),
    async execute(_id: string, args: { app?: string }) {
      return handlers.connectedApps(args);
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
        description: "App name or ID (from connected_apps or context)",
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
      return handlers.appAction(args);
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
        description: "App name or ID (from connected_apps or context)",
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
      return handlers.appActionBatch(args);
    },
  });
}
