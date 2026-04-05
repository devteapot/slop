import { SlopClientImpl } from "./client";
import type { SlopClient, SlopClientOptions, Transport } from "@slop-ai/core";
import { createPostMessageTransport } from "./postmessage-transport";
import { createWebSocketTransport } from "./websocket-transport";

export interface CreateSlopOptions<S = unknown> extends SlopClientOptions<S> {
  schema?: S;
  desktopUrl?: string | boolean;
  websocketUrl?: string | boolean;
  transports?: Array<"postmessage" | "websocket">;
  postmessageDiscover?: boolean;
  websocketDiscover?: boolean;
}

/**
 * Create a SLOP browser provider. This is the main entry point for adding SLOP to a client-side SPA.
 *
 * Uses postMessage transport by default and automatically injects a
 * `<meta name="slop">` discovery tag for enabled discoverable transports.
 *
 * Experimental: optionally exposes the browser provider over an outbound
 * WebSocket when `desktopUrl` or `websocketUrl` is provided (`true` for the
 * default `ws://localhost:9339/slop`, or a custom URL string).
 *
 * The supported desktop integration for in-page providers still uses the
 * browser extension relay; WebSocket transport is opt-in unless you pass
 * `transports: ["websocket"]` or add a `websocketUrl`.
 *
 * ```ts
 * const slop = createSlop({ id: "my-app", name: "My App" });
 * slop.register("inbox/messages", {
 *   type: "collection",
 *   items: messages.map(m => ({
 *     id: m.id,
 *     props: { title: m.title },
 *     actions: { delete: () => removeMessage(m.id) },
 *   })),
 * });
 * ```
 */
export function createSlop<S = unknown>(
  options: CreateSlopOptions<S>
): SlopClient<S> {
  const transports: Transport[] = [];
  const enabledTransports = options.transports ?? [
    "postmessage",
    ...((options.websocketUrl ?? options.desktopUrl) ? ["websocket" as const] : []),
  ];
  const websocketUrl = options.websocketUrl ?? options.desktopUrl;

  if (enabledTransports.includes("postmessage")) {
    transports.push(
      createPostMessageTransport({ discover: options.postmessageDiscover })
    );
  }

  if (enabledTransports.includes("websocket")) {
    const url = typeof websocketUrl === "string" ? websocketUrl : undefined;
    transports.push(
      createWebSocketTransport(url, { discover: options.websocketDiscover })
    );
  }

  const client = new SlopClientImpl<S>(options, transports);
  client.start();
  return client;
}

// Export the client class
export { SlopClientImpl } from "./client";

// Re-export core types and utilities for convenience
export {
  ProviderBase,
  pick, omit, action,
  assembleTree, diffNodes,
  prepareTree, getSubtree, truncateTree, autoCompact, filterTree, countNodes,
} from "@slop-ai/core";

export type {
  SlopClient,
  SlopClientOptions,
  NodeDescriptor,
  ItemDescriptor,
  Action,
  ActionHandler,
  ParamDef,
  SlopNode,
  Affordance,
  NodeMeta,
  JsonSchema,
  PatchOp,
  ContentRef,
  WindowDescriptor,
  TaskHandle,
  InferParams,
  Transport,
  ExtractPaths,
  ExtractSubSchema,
  SubscriptionFilter,
  OutputRequest,
  OutputTreeOptions,
} from "@slop-ai/core";

export { createPostMessageTransport } from "./postmessage-transport";
export { createWebSocketTransport } from "./websocket-transport";
