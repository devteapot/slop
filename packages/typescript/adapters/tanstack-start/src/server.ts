// Server-side exports
export { createWebSocketHandler } from "./ws-handler";
export type { SlopHandlerOptions } from "./ws-handler";
export { slopVitePlugin } from "./vite-plugin";
import { refreshMountedUi } from "./mount-registry";

import { createSlopServer as _createSlopServer, SlopServer } from "@slop-ai/server";
import type { SlopServerOptions } from "@slop-ai/server";

declare global {
  var __slop_instances: Map<string, SlopServer<unknown>> | undefined;
  var __slop_shared_state: Map<string, Record<string, unknown>> | undefined;
}

const instances = (globalThis.__slop_instances ??= new Map<string, SlopServer<unknown>>());

/**
 * Create a SLOP server instance, shared across Vite module environments.
 *
 * In Vite's dev server, server functions and plugins run in separate module
 * runners, creating duplicate module instances. This wrapper ensures only one
 * SlopServer exists per `id`, so the WebSocket handler and server functions
 * share the same tree.
 */
export function createSlopServer<S = unknown>(options: SlopServerOptions<S>): SlopServer<S> {
  const existing = instances.get(options.id);
  if (existing) return existing as SlopServer<S>;

  const server = _createSlopServer(options);
  instances.set(options.id, server);
  return server;
}

/**
 * Create a shared state object that survives Vite module environment duplication.
 *
 * In dev, Vite may load `state.ts` multiple times in different module runners.
 * Without sharing, mutations in server functions won't be visible to the SLOP
 * WebSocket handler. This helper ensures one copy of the state exists.
 *
 * ```ts
 * const state = sharedState("my-app", {
 *   todos: [{ id: "1", title: "Hello", done: false }],
 *   nextId: 100,
 * });
 *
 * export function getTodos() { return state.todos; }
 * export function addTodo(title: string) { state.todos.push({ ... }); }
 * ```
 *
 * In production (single module environment), this is effectively a no-op.
 */
export function sharedState<T extends Record<string, any>>(id: string, initial: T): T {
  const states = (globalThis.__slop_shared_state ??= new Map<string, Record<string, unknown>>());
  const existing = states.get(id);
  if (existing) return existing as T;

  states.set(id, initial);
  return initial;
}

/**
 * Creates the server-side callback for a TanStack Start middleware
 * that auto-refreshes the SLOP tree after any server function completes.
 *
 * Usage in your slop.ts:
 * ```ts
 * import { createMiddleware } from "@tanstack/react-start";
 * import { createSlopServer, createSlopRefreshFn } from "@slop-ai/tanstack-start/server";
 *
 * export const slop = createSlopServer({ id: "my-app", name: "My App" });
 * export const slopMiddleware = createMiddleware().server(createSlopRefreshFn(slop));
 * ```
 *
 * Then in server functions:
 * ```ts
 * const addTask = createServerFn({ method: "POST" })
 *   .middleware([slopMiddleware])
 *   .handler(async ({ data }) => {
 *     addTask(data.title);
 *     // No slop.refresh() needed
 *   });
 * ```
 */
export function createSlopRefreshFn(slop: SlopServer) {
  return async <T>(next: () => Promise<T>) => {
    const result = await next();
    slop.refresh();
    await refreshMountedUi(slop);
    return result;
  };
}

// Re-export ws for the Vite plugin so examples don't need it as a direct dep
export { WebSocketServer } from "ws";

// Re-export types
export { SlopServer } from "@slop-ai/server";
export type { SlopServerOptions, Connection } from "@slop-ai/server";
