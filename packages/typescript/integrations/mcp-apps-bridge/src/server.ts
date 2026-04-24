import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SlopConsumer, WebSocketClientTransport, affordancesToTools } from "@slop-ai/consumer";
import type { SlopNode } from "@slop-ai/consumer";
import { z } from "zod";

// Permissive object schema — accepts any JSON-serializable record so the model
// can call tools with arbitrary keys (e.g. `target`, `title`). We carry the
// real shape in the tool description until the SDK accepts JSON Schema
// directly (or we add JSON Schema → Zod conversion). The cast bypasses the
// SDK's overly-narrow ZodRawShapeCompat constraint.
const PASSTHROUGH = z.object({}).passthrough() as never;

export interface RegisterSlopViewOptions {
  /** MCP tool name that opens the view. Example: `open_kanban`. */
  toolName: string;
  /** Tool description shown to the model and host. */
  description?: string;
  /** Fully-qualified UI resource URI. Example: `ui://kanban/slop`. */
  resourceUri: string;
  /** Display name for the resource entry. Defaults to the tool name. */
  resourceName?: string;
  /** HTML (or fetcher) served for the `ui://` resource — the iframe bundle. */
  html: string | (() => string | Promise<string>);
  /**
   * Optional overrides for the resource metadata (CSP, extra meta). Merged on
   * top of the MCP Apps mime-type default.
   */
  resourceMeta?: Record<string, unknown>;
  /**
   * Origins the iframe is allowed to make network requests to (CSP `connect-src`).
   * Sandboxed hosts (e.g. VS Code's webview) block all network by default — list
   * any WebSocket/HTTP origins the iframe needs to reach the SLOP provider.
   *
   * @example ["ws://127.0.0.1:7411"]
   */
  connectDomains?: string[];
}

/**
 * Register a SLOP-backed MCP App surface on an MCP server.
 *
 * Thin facade over `registerAppTool` + `registerAppResource` from
 * `@modelcontextprotocol/ext-apps/server`:
 * - The tool returns no text content; the UI resource is the payload.
 * - The resource callback serves the provided HTML under `RESOURCE_MIME_TYPE`.
 *
 * Callers who need richer behavior (tool arguments, conditional UI, server-side
 * state) should call the underlying ext-apps helpers directly.
 */
export function registerSlopView(
  server: Pick<McpServer, "registerTool" | "registerResource">,
  options: RegisterSlopViewOptions,
): void {
  const description = options.description ?? `Open a live SLOP view (${options.toolName})`;

  registerAppTool(
    server as Pick<McpServer, "registerTool">,
    options.toolName,
    {
      description,
      inputSchema: undefined,
      _meta: { ui: { resourceUri: options.resourceUri } },
    },
    async () => ({ content: [] }),
  );

  const resourceName = options.resourceName ?? options.toolName;
  const htmlSource = options.html;
  const baseMeta = (options.resourceMeta?._meta as Record<string, unknown>) ?? {};
  const baseUi = (baseMeta.ui as Record<string, unknown>) ?? {};
  const mergedMeta: Record<string, unknown> = {
    ...options.resourceMeta,
    _meta: {
      ...baseMeta,
      ui: {
        ...baseUi,
        ...(options.connectDomains && {
          csp: { connectDomains: options.connectDomains, ...((baseUi.csp as object) ?? {}) },
        }),
      },
    },
  };

  // ext-apps spec: when resources/read content items carry their own _meta.ui,
  // it takes precedence over the listing-level metadata. Hosts (notably VS Code)
  // tend to read CSP from the content item, so we duplicate the declaration here.
  const contentMeta = options.connectDomains
    ? { ui: { csp: { connectDomains: options.connectDomains } } }
    : undefined;

  registerAppResource(
    server as Pick<McpServer, "registerResource">,
    resourceName,
    options.resourceUri,
    mergedMeta,
    async () => {
      const text = typeof htmlSource === "function" ? await htmlSource() : htmlSource;
      return {
        contents: [
          {
            uri: options.resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text,
            ...(contentMeta && { _meta: contentMeta }),
          },
        ],
      };
    },
  );
}

export { RESOURCE_MIME_TYPE };

// ---------------------------------------------------------------------------
// registerSlopTools — model-callable affordances backed by an upstream SLOP provider
// ---------------------------------------------------------------------------

export interface RegisterSlopToolsOptions {
  /** WebSocket URL of the upstream SLOP provider. */
  url: string;
  /** Subscription depth. Default `-1` (entire tree). */
  depth?: number;
  /** Salience floor for the subscription. */
  minSalience?: number;
  /**
   * Optional prefix prepended to every generated MCP tool name. Useful when
   * multiple SLOP providers share an MCP server and tool-name collisions are
   * possible.
   */
  toolNamePrefix?: string;
  /**
   * If true, mark every generated tool with the given UI resource URI so the
   * host opens (or reuses) the bridged view when the model invokes one.
   */
  uiResourceUri?: string;
}

export interface SlopToolsHandle {
  /** Number of MCP tools currently registered against the provider. */
  size(): number;
  /** Force a re-sync against the current SLOP tree (normally automatic). */
  sync(): void;
  /** Stop syncing, unsubscribe, and remove all registered tools. */
  dispose(): void;
}

/**
 * Walk an upstream SLOP provider's affordances and expose each one as an MCP
 * tool the host model can call from chat. Resyncs on every patch and emits
 * `tools/listChanged` so MCP clients re-fetch the tool catalog.
 *
 * SLOP affordances become MCP tools schemaless for v0.1 — the affordance
 * description carries enough signal for the model. Future versions can
 * convert SLOP JSON Schema params into Zod for stricter validation.
 */
export async function registerSlopTools(
  server: McpServer,
  options: RegisterSlopToolsOptions,
): Promise<SlopToolsHandle> {
  const consumer = new SlopConsumer(new WebSocketClientTransport(options.url));
  await consumer.connect();
  const { id: subId } = await consumer.subscribe("/", options.depth ?? -1, {
    ...(options.minSalience != null && { filter: { min_salience: options.minSalience } }),
  });

  const registered = new Map<string, RegisteredTool>();
  const prefix = options.toolNamePrefix ?? "";

  function buildHandler(
    resolved: { path: string | null; action: string },
  ): (args: Record<string, unknown> | undefined) => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }> {
    return async (args) => {
      let path = resolved.path;
      let params: Record<string, unknown> = { ...(args ?? {}) };
      if (path === null) {
        const target = params.target;
        if (typeof target !== "string") {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: `missing required \`target\` parameter` },
            ],
          };
        }
        path = target;
        delete params.target;
      }
      const result = await consumer.invoke(path, resolved.action, params);
      const data = result.data ?? result.status ?? "ok";
      const text =
        typeof data === "string" ? data : JSON.stringify(data, null, 2);
      return {
        content: [{ type: "text" as const, text }],
        ...(result.status === "error" && { isError: true }),
      };
    };
  }

  function sync(): void {
    const tree: SlopNode | null = consumer.getTree(subId);
    if (!tree) return;
    const toolSet = affordancesToTools(tree);

    const wantedNames = new Set<string>();
    for (const t of toolSet.tools) {
      const name = `${prefix}${t.function.name}`;
      wantedNames.add(name);
      const resolved = toolSet.resolve(t.function.name);
      if (!resolved) continue;
      const handler = buildHandler(resolved);
      const description = describeWithParams(
        t.function.description,
        t.function.parameters,
        resolved.targets,
      );
      const meta = options.uiResourceUri
        ? { ui: { resourceUri: options.uiResourceUri } }
        : undefined;
      const existing = registered.get(name);
      if (existing) {
        existing.update({
          description,
          callback: handler as never,
          ...(meta && { _meta: meta }),
        });
      } else {
        const reg = server.registerTool(
          name,
          {
            description,
            inputSchema: PASSTHROUGH,
            ...(meta && { _meta: meta }),
          },
          handler as never,
        );
        registered.set(name, reg);
      }
    }
    // Remove tools whose backing affordance disappeared.
    for (const [name, reg] of registered) {
      if (!wantedNames.has(name)) {
        reg.remove();
        registered.delete(name);
      }
    }
    server.sendToolListChanged();
  }

  // Initial sync; debounce subsequent patch-driven syncs to avoid storms.
  sync();
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;
  const onPatch = (s: string) => {
    if (s !== subId) return;
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(sync, 50);
  };
  consumer.on("patch", onPatch);

  let disposed = false;

  // The MCP SDK only accepts Zod schemas for inputSchema; we inline JSON-schema
  // hints into the tool description until JSON-Schema → Zod conversion lands.
  function describeWithParams(
    base: string,
    params: Record<string, unknown> | undefined,
    targets?: string[],
  ): string {
    const props = (params?.properties as Record<string, { type?: string; description?: string }>) ?? {};
    const required = (params?.required as string[]) ?? [];
    const lines = Object.entries(props).map(([k, v]) => {
      const req = required.includes(k) ? " (required)" : "";
      const type = v.type ?? "any";
      const hint = v.description ? ` — ${v.description}` : "";
      return `  - ${k}: ${type}${req}${hint}`;
    });
    const targetHint =
      targets && targets.length
        ? `\nValid \`target\` paths: ${targets.slice(0, 5).join(", ")}${targets.length > 5 ? ", …" : ""}`
        : "";
    return lines.length ? `${base}\nParameters:\n${lines.join("\n")}${targetHint}` : `${base}${targetHint}`;
  }

  return {
    size: () => registered.size,
    sync,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (resyncTimer) clearTimeout(resyncTimer);
      consumer.off("patch", onPatch);
      for (const reg of registered.values()) reg.remove();
      registered.clear();
      consumer.unsubscribe(subId);
      consumer.disconnect();
    },
  };
}
