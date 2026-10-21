import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { affordancesToTools, formatTree, type SlopNode, StateMirror } from "@slop-ai/consumer";
import { z } from "zod";
import { isPlainRecord } from "./protocol";
import { RelayError, type RelayHub, type SelectedProviderState, type StatePayload, type ToolResult } from "./types";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

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

interface OpenedApp {
  providerId: string;
  providerName: string;
  subId: string;
  mirror: StateMirror;
  stale?: RelayError;
  updatedAt: number;
}

export interface BridgeMcpSession {
  id: string;
  userId: string;
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  openedApps: Map<string, OpenedApp>;
  touch(): void;
  close(): Promise<void>;
}

export interface CreateMcpSessionOptions {
  id: string;
  userId: string;
  transport: WebStandardStreamableHTTPServerTransport;
  relayHub: RelayHub;
  onIdle: (sessionId: string) => void;
  idleTimeoutMs?: number;
}

export function createMcpSession(options: CreateMcpSessionOptions): BridgeMcpSession {
  const openedApps = new Map<string, OpenedApp>();
  const server = new McpServer(
    { name: "slop-bridge-server", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const session: BridgeMcpSession = {
    id: options.id,
    userId: options.userId,
    server,
    transport: options.transport,
    openedApps,
    touch,
    async close() {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      options.relayHub.markSessionClosed(options.userId, session.id);
      await options.transport.close().catch(() => {});
      openedApps.clear();
    },
  };

  function touch(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      options.onIdle(session.id);
    }, options.idleTimeoutMs ?? IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  }

  function statePayload(selectedApp?: string): StatePayload {
    const state = options.relayHub.getState(options.userId);
    const providers = (state?.providers ?? []).map((provider) => ({
      ...provider,
      connected: state?.online === true && provider.status === "connected",
    }));
    const selected = selectedApp ? openedApps.get(selectedApp) : [...openedApps.values()].at(-1);
    return {
      updatedAt: Date.now(),
      providers,
      ...(selected && { selected: selectedState(selected) }),
    };
  }

  function selectedState(app: OpenedApp): SelectedProviderState {
    const tree = app.mirror.getTree();
    return {
      id: app.providerId,
      name: app.providerName,
      tree,
      formatted: formatTree(tree),
      actions: describeActions(app.providerId, tree),
      ...(app.stale && { stale: true }),
    };
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

  async function ensureOpenApp(appId: string): Promise<OpenedApp> {
    const existing = openedApps.get(appId);
    if (existing && !existing.stale) {
      return existing;
    }

    if (existing) {
      options.relayHub.unsubscribe(options.userId, existing.subId);
      openedApps.delete(appId);
    }

    const { subId, snapshot } = await options.relayHub.subscribe({
      userId: options.userId,
      sessionId: session.id,
      providerId: appId,
      onSnapshot: (frame) => {
        const app = openedApps.get(appId);
        if (!app) return;
        app.mirror = new StateMirror({
          type: "snapshot",
          id: frame.subId,
          version: frame.version ?? 0,
          seq: frame.seq,
          tree: frame.tree,
        });
        app.stale = undefined;
        app.updatedAt = Date.now();
      },
      onPatch: (ops, version, seq) => {
        const app = openedApps.get(appId);
        if (!app) return;
        app.mirror.applyPatch({ type: "patch", subscription: app.subId, version, seq, ops });
        app.updatedAt = Date.now();
      },
      onStale: (error) => {
        const app = openedApps.get(appId);
        if (app) app.stale = error;
      },
    });

    const providerName =
      options.relayHub.getState(options.userId)?.providers.find((provider) => provider.id === appId)?.name ?? appId;
    const opened: OpenedApp = {
      providerId: appId,
      providerName,
      subId,
      mirror: new StateMirror({
        type: "snapshot",
        id: subId,
        version: snapshot.version ?? 0,
        seq: snapshot.seq,
        tree: snapshot.tree,
      }),
      updatedAt: Date.now(),
    };
    openedApps.set(appId, opened);
    return opened;
  }

  function summarizeState(payload: StatePayload): string {
    if (payload.selected) {
      const actions = payload.selected.actions
        .map((action) => {
          const location = action.path ?? (action.targets ? `${action.targets.length} targets` : "dynamic target");
          return `- ${action.action} on ${location}: ${action.description}`;
        })
        .join("\n");
      return (
        `Opened ${payload.selected.name} (id: ${payload.selected.id}).\n\n` +
        `Current state:\n\n${payload.selected.formatted}\n\n` +
        `Available actions:\n${actions || "(none)"}`
      );
    }

    if (payload.providers.length === 0) {
      return "No SLOP relay providers are currently connected. Start slop-relay on the user's machine.";
    }

    return `Available SLOP applications:\n${payload.providers
      .map((provider) => `- ${provider.name} (id: ${provider.id}, ${provider.transport}, ${provider.status})`)
      .join("\n")}`;
  }

  server.registerTool(
    "list_apps",
    {
      description: "List SLOP-enabled applications currently visible through the user's relay.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      touch();
      const payload = statePayload();
      return {
        ...jsonResult(payload),
        content: [{ type: "text", text: summarizeState(payload) }],
      };
    },
  );

  server.registerTool(
    "open_app",
    {
      description: "Open and inspect a SLOP application by exact app id.",
      inputSchema: {
        app: z.string().describe("SLOP app id from list_apps."),
      } as never,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (async (args: OpenAppArgs) => {
      touch();
      const app = typeof args.app === "string" ? args.app : "";
      if (!app) return errorResult("Missing app id.");
      try {
        await ensureOpenApp(app);
        const payload = statePayload(app);
        return {
          ...jsonResult(payload),
          content: [{ type: "text", text: summarizeState(payload) }],
        };
      } catch (error) {
        return errorFromUnknown(error);
      }
    }) as never,
  );

  server.registerTool(
    "slop_get_state",
    {
      description: "Return the latest cached SLOP state for an opened app.",
      inputSchema: {
        app: z.string().optional().describe("SLOP app id. Defaults to the most recently opened app."),
      } as never,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    (async (args: OpenAppArgs) => {
      touch();
      const appId = typeof args.app === "string" ? args.app : [...openedApps.keys()].at(-1);
      if (appId) {
        const app = openedApps.get(appId);
        if (app?.stale) {
          try {
            await ensureOpenApp(appId);
          } catch {}
        }
      }
      return jsonResult(statePayload(appId));
    }) as never,
  );

  server.registerTool(
    "app_action",
    {
      description: "Perform a single SLOP affordance. Use action coordinates shown by open_app or slop_get_state.",
      inputSchema: {
        app: z.string().describe("SLOP app id."),
        path: z.string().describe("Path to the target node."),
        action: z.string().describe("Affordance/action name."),
        params: z.record(z.string(), z.unknown()).optional().describe("Optional action parameters."),
      } as never,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (async (args: AppActionArgs) => {
      touch();
      if (!isPlainRecord(args.params ?? {})) return errorResult("params must be an object when provided.");
      const result = await invokeAction(args.app, args.path, args.action, args.params ?? {});
      return result;
    }) as never,
  );

  server.registerTool(
    "app_action_batch",
    {
      description: "Perform multiple SLOP affordances sequentially.",
      inputSchema: {
        app: z.string().describe("SLOP app id."),
        actions: z.array(
          z.object({
            path: z.string(),
            action: z.string(),
            params: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
      } as never,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (async (args: AppActionBatchArgs) => {
      touch();
      let failed = 0;
      const lines: string[] = [];
      for (const action of args.actions ?? []) {
        const result = await invokeAction(args.app, action.path, action.action, action.params ?? {});
        if (result.isError) {
          failed += 1;
          lines.push(`FAIL: ${action.action} on ${action.path} - ${result.content[0]?.text ?? "unknown error"}`);
        } else {
          lines.push(`OK: ${action.action} on ${action.path}`);
        }
      }
      return { isError: failed > 0, content: [{ type: "text", text: lines.join("\n") || "(no actions)" }] };
    }) as never,
  );

  async function invokeAction(
    app: string,
    path: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ToolResult> {
    try {
      const frame = await options.relayHub.invoke({
        userId: options.userId,
        providerId: app,
        path,
        action,
        params,
      });
      if (!frame.ok) {
        return errorResult(`[${frame.error.code}] ${frame.error.message}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `Done.${frame.data !== undefined ? ` Result: ${JSON.stringify(frame.data)}` : ""}`,
          },
        ],
      };
    } catch (error) {
      return errorFromUnknown(error);
    }
  }

  function errorFromUnknown(error: unknown): ToolResult {
    if (error instanceof RelayError) {
      return errorResult(`[${error.code}] ${error.message}`);
    }
    return errorResult(error instanceof Error ? error.message : String(error));
  }

  touch();
  return session;
}

function describeActions(providerId: string, tree: SlopNode) {
  const toolSet = affordancesToTools(tree);
  return toolSet.tools.flatMap((tool) => {
    const resolved = toolSet.resolve(tool.function.name);
    if (!resolved) return [];
    return [
      {
        name: `${providerId.replace(/[^a-zA-Z0-9]/g, "_")}__${tool.function.name}`,
        description: tool.function.description,
        path: resolved.path,
        action: resolved.action,
        targets: resolved.targets,
        parameters: tool.function.parameters,
      },
    ];
  });
}
