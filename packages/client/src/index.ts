import { SlopClientImpl } from "@slop-ai/core";
import type { SlopClient, SlopClientOptions } from "@slop-ai/core";
import { createPostMessageTransport } from "./postmessage-transport";

/**
 * Create a SLOP browser provider. This is the main entry point for adding SLOP to a client-side SPA.
 *
 * Uses postMessage transport and automatically injects a `<meta name="slop">` discovery tag.
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
  options: SlopClientOptions<S> & { schema?: S }
): SlopClient<S> {
  const transport = createPostMessageTransport();
  const client = new SlopClientImpl<S>(options, transport);
  client.start();
  return client;
}

// Re-export everything from core for convenience
export {
  SlopClientImpl,
  pick, omit, action,
  assembleTree, diffNodes,
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
} from "@slop-ai/core";

export { createPostMessageTransport } from "./postmessage-transport";
