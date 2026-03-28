import { SlopClientImpl } from "./client";
import type { SlopClient, SlopClientOptions, NodeDescriptor } from "./types";

/**
 * Create a SLOP client. This is the main entry point for adding SLOP to your app.
 *
 * ```ts
 * const slop = createSlop({ id: "my-app", name: "My App" });
 *
 * // Register nodes from any component
 * slop.register("inbox/messages", {
 *   type: "collection",
 *   props: { count: messages.length },
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
  const client = new SlopClientImpl<S>(options);
  client.start();
  return client;
}

// Re-export types
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
} from "./types";

// Re-export schema types
export type { ExtractPaths, ExtractSubSchema } from "./schema-types";
