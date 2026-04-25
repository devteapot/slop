#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { affordancesToTools, formatTree, type SlopNode } from "@slop-ai/consumer";
import { createDiscoveryService, type ConnectedProvider, type ProviderDescriptor } from "@slop-ai/discovery/service";
import { createDynamicTools, createToolHandlers, type DynamicToolSet } from "@slop-ai/discovery/tools";
import { z } from "zod";

const VERSION = readPackageVersion();
const RESOURCE_URI = "ui://slop/discovered-app";
const PASSTHROUGH = z.object({}).passthrough() as never;

type ToolContent = { type: "text"; text: string };
type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

interface ProviderSummary {
  id: string;
  name: string;
  transport: ProviderDescriptor["transport"]["type"];
  source: ProviderDescriptor["source"] | "local";
  connected: boolean;
  status?: ConnectedProvider["status"];
}

interface ActionSummary {
  name: string;
  description: string;
  path: string | null;
  action: string;
  targets?: string[];
  parameters: Record<string, unknown>;
}

interface SelectedProviderState {
  id: string;
  name: string;
  tree: SlopNode | null;
  formatted: string;
  actions: ActionSummary[];
}

interface StatePayload {
  updatedAt: number;
  providers: ProviderSummary[];
  selected?: SelectedProviderState;
}

interface OpenAppArgs {
  app?: string;
}

interface AppActionArgs {
  app: string;
  path: string;
  action: string;
  params?: Record<string, unknown>;
}

interface AppActionBatchArgs {
  app: string;
  actions: {
    path: string;
    action: string;
    params?: Record<string, unknown>;
  }[];
}

const log = {
  info: (...args: unknown[]) => console.error("[slop-mcp-apps-bridge]", ...args),
  error: (...args: unknown[]) => console.error("[slop-mcp-apps-bridge] ERROR:", ...args),
};

function readPackageVersion(): string {
  try {
    const json = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof json.version === "string" ? json.version : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

const discovery = createDiscoveryService({
  logger: log,
  autoConnect: false,
  // Client-hosted MCP servers should not crash if the OS refuses another
  // watcher. Periodic scans still pick up providers without consuming fds.
  watchProviders: false,
});
const handlers = createToolHandlers(discovery);
const server = new McpServer(
  { name: "slop-mcp-apps-bridge", version: VERSION },
  { capabilities: { tools: { listChanged: true }, resources: {} } },
);

let dynamicToolSet: DynamicToolSet = createDynamicTools(discovery);
const registeredDynamicTools = new Map<string, RegisteredTool>();
let standaloneHtml: string | null = null;

function printHelp(): void {
  console.log(`slop-mcp-apps-bridge ${VERSION}

Start a stdio MCP server that discovers local SLOP apps and exposes them as MCP Apps.

Usage:
  slop-mcp-apps-bridge
  npx -y @slop-ai/mcp-apps-bridge

Client configuration example:
  {
    "servers": {
      "slop": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@slop-ai/mcp-apps-bridge"]
      }
    }
  }
`);
}

function jsonResult(payload: StatePayload): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? { ...(args as Record<string, unknown>) } : {};
}

function notifyToolListChanged(): void {
  try {
    server.sendToolListChanged();
  } catch {
    // This can happen before the stdio transport is connected.
  }
}

function providerMatches(provider: ConnectedProvider | ProviderDescriptor, idOrName: string): boolean {
  const query = idOrName.toLowerCase();
  return provider.id.toLowerCase() === query || provider.name.toLowerCase() === query;
}

function summaryMatches(provider: ProviderSummary, idOrName: string): boolean {
  const query = idOrName.toLowerCase();
  return provider.id.toLowerCase() === query || provider.name.toLowerCase() === query;
}

function summarizeProviders(): ProviderSummary[] {
  const connected = discovery.getProviders();
  const connectedById = new Map(connected.map((provider) => [provider.id, provider]));
  const summaries: ProviderSummary[] = [];
  const seen = new Set<string>();

  for (const descriptor of discovery.getDiscovered()) {
    const provider = connectedById.get(descriptor.id);
    summaries.push({
      id: descriptor.id,
      name: provider?.name ?? descriptor.name,
      transport: descriptor.transport.type,
      source: descriptor.source ?? "local",
      connected: !!provider,
      status: provider?.status,
    });
    seen.add(descriptor.id);
  }

  for (const provider of connected) {
    if (seen.has(provider.id)) continue;
    summaries.push({
      id: provider.id,
      name: provider.name,
      transport: provider.descriptor.transport.type,
      source: provider.descriptor.source ?? "local",
      connected: true,
      status: provider.status,
    });
  }

  return summaries;
}

function describeActions(provider: ConnectedProvider, tree: SlopNode | null): ActionSummary[] {
  if (!tree) return [];
  const toolSet = affordancesToTools(tree);
  return toolSet.tools.flatMap((tool) => {
    const resolved = toolSet.resolve(tool.function.name);
    if (!resolved) return [];
    return [
      {
        name: `${provider.id.replace(/[^a-zA-Z0-9]/g, "_")}__${tool.function.name}`,
        description: tool.function.description,
        path: resolved.path,
        action: resolved.action,
        targets: resolved.targets,
        parameters: tool.function.parameters,
      },
    ];
  });
}

async function getStatePayload(app?: string, connect = false): Promise<StatePayload> {
  let selected: ConnectedProvider | null = null;

  if (app) {
    selected = connect
      ? await discovery.ensureConnected(app)
      : (discovery.getProviders().find((p) => providerMatches(p, app)) ?? null);
  }

  const providers = summarizeProviders();
  const payload: StatePayload = {
    updatedAt: Date.now(),
    providers,
  };

  if (selected) {
    const tree = selected.consumer.getTree(selected.subscriptionId);
    payload.selected = {
      id: selected.id,
      name: selected.name,
      tree,
      formatted: tree ? formatTree(tree) : "(no state yet)",
      actions: describeActions(selected, tree),
    };
  } else if (app && !providers.some((provider) => summaryMatches(provider, app))) {
    log.info(`App not found: ${app}`);
  }

  return payload;
}

function summarizeState(payload: StatePayload): string {
  if (payload.selected) {
    const actionCount = payload.selected.actions.length;
    return (
      `Opened ${payload.selected.name} (id: ${payload.selected.id}).\n\n` +
      `Available actions: ${actionCount}\n\n` +
      `Current state:\n\n${payload.selected.formatted}`
    );
  }

  if (payload.providers.length === 0) {
    return "No SLOP applications found. Start a SLOP-enabled app, then call list_apps or open_app again.";
  }

  const lines = payload.providers.map((provider) => {
    const status = provider.connected ? "connected" : "available";
    return `- ${provider.name} (id: ${provider.id}, ${provider.transport}, ${status})`;
  });
  return `Available SLOP applications:\n${lines.join("\n")}`;
}

function describeWithParams(base: string, params: Record<string, unknown> | undefined, targets?: string[]): string {
  const props = (params?.properties as Record<string, { type?: string; description?: string }>) ?? {};
  const required = (params?.required as string[]) ?? [];
  const lines = Object.entries(props).map(([key, value]) => {
    const requiredHint = required.includes(key) ? " (required)" : "";
    const type = value.type ?? "any";
    const hint = value.description ? ` - ${value.description}` : "";
    return `  - ${key}: ${type}${requiredHint}${hint}`;
  });
  const targetHint =
    targets && targets.length
      ? `\nValid target paths: ${targets.slice(0, 8).join(", ")}${targets.length > 8 ? ", ..." : ""}`
      : "";
  return lines.length ? `${base}\nParameters:\n${lines.join("\n")}${targetHint}` : `${base}${targetHint}`;
}

async function invokeDynamicTool(toolName: string, args: unknown): Promise<ToolResult> {
  const resolved = dynamicToolSet.resolve(toolName);
  if (!resolved) return errorResult(`Unknown tool: ${toolName}`);

  const provider = discovery.getProvider(resolved.providerId);
  if (!provider) return errorResult(`App "${resolved.providerId}" is disconnected. Call open_app to reconnect.`);

  let invokePath = resolved.path;
  const params = normalizeArgs(args);

  if (invokePath === null) {
    const target = params.target;
    if (typeof target !== "string") {
      return errorResult('Missing required "target" parameter.');
    }
    if (resolved.targets && !resolved.targets.includes(target)) {
      return errorResult(`Invalid target "${target}". Valid targets: ${resolved.targets.join(", ")}`);
    }
    invokePath = target;
    delete params.target;
  }

  const result = await provider.consumer.invoke(invokePath, resolved.action, params);
  if (result.status === "error") {
    const code = result.error?.code ?? "error";
    const message = result.error?.message ?? "(no message)";
    return errorResult(`Action failed: [${code}] ${message}`);
  }

  return {
    content: [
      {
        type: "text",
        text: `Done.${result.data ? ` Result: ${JSON.stringify(result.data)}` : ""}`,
      },
    ],
  };
}

function syncDynamicTools(): void {
  const next = createDynamicTools(discovery);
  const wanted = new Set(next.tools.map((tool) => tool.name));
  let changed = false;

  dynamicToolSet = next;

  for (const tool of next.tools) {
    const description = describeWithParams(tool.description, tool.inputSchema, tool.targets);
    const existing = registeredDynamicTools.get(tool.name);
    if (existing) {
      existing.update({
        description,
        paramsSchema: PASSTHROUGH,
        callback: ((args: unknown) => invokeDynamicTool(tool.name, args)) as never,
      });
      continue;
    }

    registeredDynamicTools.set(
      tool.name,
      server.registerTool(
        tool.name,
        {
          description,
          inputSchema: PASSTHROUGH,
        },
        ((args: unknown) => invokeDynamicTool(tool.name, args)) as never,
      ),
    );
    changed = true;
  }

  for (const [name, tool] of registeredDynamicTools) {
    if (wanted.has(name)) continue;
    tool.remove();
    registeredDynamicTools.delete(name);
    changed = true;
  }

  if (changed) notifyToolListChanged();
}

async function readStandaloneHtml(): Promise<string> {
  if (standaloneHtml) return standaloneHtml;
  const script = await readFile(new URL("./standalone-app.js", import.meta.url), "utf8");
  standaloneHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SLOP Apps</title>
  </head>
  <body>
    <div id="app">Loading SLOP app...</div>
    <script type="module">${script.replaceAll("</script", "<\\/script")}</script>
  </body>
</html>`;
  return standaloneHtml;
}

registerAppResource(
  server,
  "SLOP App View",
  RESOURCE_URI,
  {
    description: "Generic view for discovered SLOP applications",
  },
  async () => {
    const html = await readStandaloneHtml();
    return {
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
        },
      ],
    };
  },
);

server.registerTool(
  "list_apps",
  {
    description: "List SLOP-enabled applications available on this computer.",
    inputSchema: {},
  },
  async () => handlers.listApps(),
);

registerAppTool(
  server,
  "open_app",
  {
    description:
      "Open a discovered SLOP application as an MCP App view. Use list_apps first if you do not know the app name or ID.",
    inputSchema: {
      app: z.string().optional().describe("SLOP app name or ID to open."),
    } as never,
    _meta: {
      ui: { resourceUri: RESOURCE_URI },
    },
  },
  (async (args: OpenAppArgs): Promise<ToolResult> => {
    const app = typeof args.app === "string" ? args.app : undefined;
    const payload = await getStatePayload(app, true);
    syncDynamicTools();

    if (app && !payload.selected) {
      return {
        ...jsonResult(payload),
        content: [{ type: "text", text: `App "${app}" not found or could not connect.\n\n${summarizeState(payload)}` }],
      };
    }

    return {
      ...jsonResult(payload),
      content: [{ type: "text", text: summarizeState(payload) }],
    };
  }) as never,
);

server.registerTool(
  "slop_get_state",
  {
    description: "App-only helper used by the SLOP MCP Apps iframe to refresh discovered provider state.",
    inputSchema: {
      app: z.string().optional().describe("SLOP app name or ID to connect and read."),
    } as never,
    _meta: {
      ui: { visibility: ["app"] },
    },
  },
  (async (args: OpenAppArgs): Promise<ToolResult> => {
    const app = typeof args.app === "string" ? args.app : undefined;
    const payload = await getStatePayload(app, !!app);
    syncDynamicTools();
    return jsonResult(payload);
  }) as never,
);

server.registerTool(
  "app_action",
  {
    description:
      "Perform a single SLOP affordance on an application. Use the exact app, path, action, and params shown by open_app or the app view.",
    inputSchema: {
      app: z.string().describe("SLOP app name or ID."),
      path: z.string().describe("Path to the node to act on, for example '/' or '/todos/todo-1'."),
      action: z.string().describe("Affordance/action name to invoke."),
      params: z.record(z.unknown()).optional().describe("Optional action parameters."),
    } as never,
  },
  (async (args: AppActionArgs): Promise<ToolResult> => {
    const provider = await discovery.ensureConnected(args.app);
    if (!provider) return errorResult(`App "${args.app}" not found or could not connect.`);

    const result = await provider.consumer.invoke(args.path, args.action, args.params ?? {});
    if (result.status === "error") {
      return errorResult(
        `Action failed: [${result.error?.code ?? "error"}] ${result.error?.message ?? "(no message)"}`,
      );
    }

    syncDynamicTools();
    return {
      content: [
        {
          type: "text",
          text: `Done. ${args.action} on ${args.path} succeeded.${result.data ? ` Result: ${JSON.stringify(result.data)}` : ""}`,
        },
      ],
    };
  }) as never,
);

server.registerTool(
  "app_action_batch",
  {
    description:
      "Perform multiple SLOP affordances on an application in one call. Prefer this for repeated or bulk operations.",
    inputSchema: {
      app: z.string().describe("SLOP app name or ID."),
      actions: z
        .array(
          z.object({
            path: z.string().describe("Path to the node to act on."),
            action: z.string().describe("Affordance/action name to invoke."),
            params: z.record(z.unknown()).optional().describe("Optional action parameters."),
          }),
        )
        .describe("Actions to perform sequentially."),
    } as never,
  },
  (async (args: AppActionBatchArgs): Promise<ToolResult> => {
    const provider = await discovery.ensureConnected(args.app);
    if (!provider) return errorResult(`App "${args.app}" not found or could not connect.`);

    const lines: string[] = [];
    let failed = 0;

    for (const action of args.actions) {
      const result = await provider.consumer.invoke(action.path, action.action, action.params ?? {});
      if (result.status === "error") {
        failed++;
        lines.push(
          `FAIL: ${action.action} on ${action.path} - [${result.error?.code ?? "error"}] ${result.error?.message ?? "(no message)"}`,
        );
      } else {
        lines.push(`OK: ${action.action} on ${action.path}`);
      }
    }

    syncDynamicTools();
    return {
      isError: failed > 0,
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }) as never,
);

discovery.onStateChange(() => {
  syncDynamicTools();
});

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    printHelp();
    return;
  }
  if (arg === "--version" || arg === "-v") {
    console.log(VERSION);
    return;
  }

  discovery.start();
  log.info("Discovery started");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server running on stdio");

  const stop = () => {
    discovery.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  log.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
