import { formatTree, affordancesToTools } from "@slop-ai/consumer";
import type { DiscoveryService } from "./discovery";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function createToolHandlers(discovery: DiscoveryService) {
  async function connectedApps(args: { app?: string }): Promise<ToolResult> {
    const { app } = args;

    // --- List all discovered apps ---
    if (!app) {
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
            text: `Applications on this computer:\n${lines.join("\n")}\n\nUse connected_apps with an app name to see full state and available actions.`,
          },
        ],
      };
    }

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
        const path = resolved?.path ?? "/";
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
            `### Available Actions (${toolSet.tools.length})\n${actionsText}`,
        },
      ],
    };
  }

  async function appAction(args: {
    app: string;
    path: string;
    action: string;
    params?: Record<string, unknown>;
  }): Promise<ToolResult> {
    const { app, path, action, params } = args;

    const p = await discovery.ensureConnected(app);
    if (!p) {
      return {
        content: [
          {
            type: "text",
            text: `App "${app}" not found or could not connect. Use connected_apps to see available apps.`,
          },
        ],
      };
    }

    try {
      const result = await p.consumer.invoke(path, action, params ?? {});

      if (result.status === "ok") {
        await new Promise((r) => setTimeout(r, 150));
        const tree = p.consumer.getTree(p.subscriptionId);
        const statePreview = tree ? formatTree(tree) : "(state unavailable)";

        return {
          content: [
            {
              type: "text",
              text:
                `Done. ${action} on ${path} succeeded.` +
                (result.data
                  ? ` Result: ${JSON.stringify(result.data)}`
                  : "") +
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
        isError: true,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  async function appActionBatch(args: {
    app: string;
    actions: { path: string; action: string; params?: Record<string, unknown> }[];
  }): Promise<ToolResult> {
    const { app, actions } = args;

    const p = await discovery.ensureConnected(app);
    if (!p) {
      return {
        content: [
          {
            type: "text",
            text: `App "${app}" not found or could not connect. Use connected_apps to see available apps.`,
          },
        ],
      };
    }

    const results: string[] = [];
    let failed = 0;

    for (const { path, action, params } of actions) {
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

    // Wait once for state to settle, then show final tree
    await new Promise((r) => setTimeout(r, 150));
    const tree = p.consumer.getTree(p.subscriptionId);
    const statePreview = tree ? formatTree(tree) : "(state unavailable)";

    return {
      content: [
        {
          type: "text",
          text:
            `Batch complete: ${actions.length - failed}/${actions.length} succeeded.\n` +
            results.join("\n") +
            `\n\nCurrent state:\n\`\`\`\n${statePreview}\n\`\`\``,
        },
      ],
      isError: failed > 0,
    };
  }

  return { connectedApps, appAction, appActionBatch };
}
