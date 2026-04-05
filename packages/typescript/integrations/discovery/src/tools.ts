import { formatTree, affordancesToTools, type LlmTool } from "@slop-ai/consumer";
import type { DiscoveryService, ConnectedProvider } from "./discovery";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Dynamic tool generation — turns affordances into per-app MCP tools
// ---------------------------------------------------------------------------

/** Sanitize a string for use as a tool name prefix (alphanumeric + underscore). */
function sanitizePrefix(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export interface DynamicToolEntry {
  /** Full MCP tool name, e.g. "kanban__delete" or "kanban__board__clear" */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Provider this tool belongs to */
  providerId: string;
  /** SLOP path for invoke (null for grouped tools — path comes from args.target) */
  path: string | null;
  action: string;
  /** Valid target paths for grouped tools */
  targets?: string[];
}

export interface DynamicToolSet {
  /** All dynamic tool entries across all connected providers */
  tools: DynamicToolEntry[];
  /** Resolve a dynamic tool name to invoke coordinates, or null */
  resolve(toolName: string): {
    providerId: string;
    path: string | null;
    action: string;
    targets?: string[];
  } | null;
}

/**
 * Build dynamic tool definitions from all connected providers' affordances.
 *
 * Each tool name is prefixed with the app's sanitized ID to avoid cross-app collisions:
 *   `{appPrefix}__{action}` (grouped) or `{appPrefix}__{nodeId}__{action}` (singleton)
 *
 * Grouped tools share the same action + param schema across multiple nodes.
 * They include a `target` parameter so the caller specifies which node to act on.
 *
 * Returns a DynamicToolSet with all tools and a resolve function.
 */
export function createDynamicTools(discovery: DiscoveryService): DynamicToolSet {
  const entries: DynamicToolEntry[] = [];
  const resolveMap = new Map<string, { providerId: string; path: string | null; action: string; targets?: string[] }>();

  for (const provider of discovery.getProviders()) {
    const tree = provider.consumer.getTree(provider.subscriptionId);
    if (!tree) continue;

    const appPrefix = sanitizePrefix(provider.id);
    const toolSet = affordancesToTools(tree);

    for (const tool of toolSet.tools) {
      const resolved = toolSet.resolve(tool.function.name);
      if (!resolved) continue;

      const dynamicName = `${appPrefix}__${tool.function.name}`;

      entries.push({
        name: dynamicName,
        description: `[${provider.name}] ${tool.function.description}`,
        inputSchema: tool.function.parameters,
        providerId: provider.id,
        path: resolved.path,
        action: resolved.action,
        targets: resolved.targets,
      });

      resolveMap.set(dynamicName, {
        providerId: provider.id,
        path: resolved.path,
        action: resolved.action,
        targets: resolved.targets,
      });
    }
  }

  return {
    tools: entries,
    resolve(toolName: string) {
      return resolveMap.get(toolName) ?? null;
    },
  };
}

export function createToolHandlers(discovery: DiscoveryService) {
  async function listApps(): Promise<ToolResult> {
    const discovered = discovery.getDiscovered();
    if (discovered.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No applications found. Desktop and web apps that support external control will appear here automatically when they're running.",
          },
        ],
      };
    }

    const connected = discovery.getProviders();
    const connectedIds = new Set(connected.map((p) => p.id));

    const lines = discovered.map((desc) => {
      const isConnected = connectedIds.has(desc.id);
      const provider = isConnected
        ? connected.find((p) => p.id === desc.id)
        : null;
      const tree = provider?.consumer.getTree(provider.subscriptionId);
      const actionCount = tree ? affordancesToTools(tree).tools.length : 0;
      const label = (tree?.properties?.label as string) ?? desc.name;
      const status = isConnected
        ? `connected, ${actionCount} actions`
        : "available";
      return `- **${label}** (id: \`${desc.id}\`, ${desc.transport.type}) — ${status}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Applications on this computer:\n${lines.join("\n")}\n\nUse connect_app with an app name or ID to connect and inspect it.`,
        },
      ],
    };
  }

  async function connectApp(args: { app: string }): Promise<ToolResult> {
    const { app } = args;

    // --- Show specific app (lazy connect) ---
    const p = await discovery.ensureConnected(app);
    if (!p) {
      const discovered = discovery.getDiscovered();
      const available = discovered
        .map((d) => `${d.name} (${d.id})`)
        .join(", ");
      return {
        content: [
          {
            type: "text",
            text: `App "${app}" not found. Available: ${available || "none"}`,
          },
        ],
      };
    }

    const tree = p.consumer.getTree(p.subscriptionId);
    if (!tree) {
      return {
        content: [
          {
            type: "text",
            text: `${p.name} is connected but has no state yet.`,
          },
        ],
      };
    }

    const toolSet = affordancesToTools(tree);
    const actionsText = toolSet.tools
      .map((t) => {
        const resolved = toolSet.resolve(t.function.name);
        const action = resolved?.action ?? t.function.name;
        const pathInfo = resolved?.path
          ? `on \`${resolved.path}\``
          : `${resolved?.targets?.length ?? 0} targets`;
        return `  - **${action}** ${pathInfo}: ${t.function.description}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text:
            `## ${p.name}\nID: \`${p.id}\`\n\n` +
            `### Current State\n\`\`\`\n${formatTree(tree)}\n\`\`\`\n\n` +
            `### Available Actions (${toolSet.tools.length})\n${actionsText}`,
        },
      ],
    };
  }

  async function disconnectApp(args: { app: string }): Promise<ToolResult> {
    const { app } = args;
    const found = discovery.disconnect(app);
    if (!found) {
      return {
        content: [
          {
            type: "text",
            text: `App "${app}" is not connected. Use list_apps to see available apps.`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Disconnected from "${app}". Its tools have been removed.`,
        },
      ],
    };
  }

  return { listApps, connectApp, disconnectApp };
}
