import { SlopClientImpl } from "./client";
import type { SlopClient, SlopClientOptions, Transport } from "@slop-ai/core";
import { createPostMessageTransport } from "./postmessage-transport";
import { createWebSocketTransport } from "./websocket-transport";

/**
 * Create a SLOP browser provider. This is the main entry point for adding SLOP to a client-side SPA.
 *
 * Uses postMessage transport and automatically injects a `<meta name="slop">` discovery tag.
 *
 * Optionally connects directly to a desktop consumer via WebSocket when
 * `desktopUrl` is provided (`true` for the default `ws://localhost:9339/slop`,
 * or a custom URL string).
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
  options: SlopClientOptions<S> & { schema?: S; desktopUrl?: string | boolean }
): SlopClient<S> {
  const transports: Transport[] = [createPostMessageTransport()];

  if (options.desktopUrl) {
    const url = typeof options.desktopUrl === "string"
      ? options.desktopUrl
      : undefined; // use default
    transports.push(createWebSocketTransport(url));
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
