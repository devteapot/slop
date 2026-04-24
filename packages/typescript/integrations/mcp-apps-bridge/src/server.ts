import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

  registerAppResource(
    server as Pick<McpServer, "registerResource">,
    resourceName,
    options.resourceUri,
    options.resourceMeta ?? {},
    async () => {
      const text = typeof htmlSource === "function" ? await htmlSource() : htmlSource;
      return {
        contents: [
          {
            uri: options.resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text,
          },
        ],
      };
    },
  );
}

export { RESOURCE_MIME_TYPE };
