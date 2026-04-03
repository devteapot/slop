import { SlopServer } from "./server";
import type { SlopServerOptions } from "./server";

/**
 * Create a SLOP server provider. This is the main entry point for adding SLOP
 * to server-backed apps (Next.js, Nuxt, SvelteKit, Express) and native apps (Electron, Tauri, CLI).
 *
 * ```ts
 * import { createSlopServer } from "@slop-ai/server";
 * import { attachSlop } from "@slop-ai/server/node";
 *
 * const slop = createSlopServer({ id: "my-app", name: "My App" });
 *
 * slop.register("todos", () => ({
 *   type: "collection",
 *   props: { count: getTodos().length },
 *   items: getTodos().map(t => ({
 *     id: t.id,
 *     props: { title: t.title, done: t.done },
 *     actions: {
 *       toggle: () => toggleTodo(t.id),
 *       delete: { handler: () => deleteTodo(t.id), dangerous: true },
 *     },
 *   })),
 * }));
 *
 * attachSlop(slop, httpServer);
 * ```
 */
export function createSlopServer<S = unknown>(
  options: SlopServerOptions<S>
): SlopServer<S> {
  return new SlopServer<S>(options);
}

// Re-export server class and types
export { SlopServer } from "./server";
export type { SlopServerOptions, DescriptorFn, Connection } from "./server";

// Re-export core types for convenience
export type {
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
} from "@slop-ai/core";

// Re-export core helpers
export { pick, omit, action } from "@slop-ai/core";
