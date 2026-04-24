import type { SlopServerOptions } from "./server";
import { SlopServer } from "./server";

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
 * attachSlop(slop, httpServer, {
 *   allowedOrigins: ["https://app.example.com"],
 *   authenticate: async (req) => verifyBearer(req.headers.authorization),
 * });
 * ```
 */
export function createSlopServer<S = unknown>(options: SlopServerOptions<S>): SlopServer<S> {
  return new SlopServer<S>(options);
}

// Re-export core types for convenience
export type {
  Action,
  ActionHandler,
  Affordance,
  ContentRef,
  InferParams,
  ItemDescriptor,
  JsonSchema,
  NodeDescriptor,
  NodeMeta,
  ParamDef,
  PatchOp,
  SlopNode,
  TaskHandle,
  WindowDescriptor,
} from "@slop-ai/core";
// Re-export core helpers
export { action, omit, pick } from "@slop-ai/core";
export type { Connection, DescriptorFn, SlopServerOptions } from "./server";
// Re-export server class and types
export { SlopServer } from "./server";
