import { afterRenderEffect, DestroyRef, inject } from "@angular/core";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

/**
 * Angular function that registers a SLOP node.
 *
 * Accepts a static or dynamic path (`string` or `() => string`).
 * Uses `afterRenderEffect` (Angular 19+) to bridge signals to the
 * SLOP protocol layer. This guarantees that `input.required()` signals
 * are initialized before the effect reads them — it runs AFTER Angular
 * completes rendering, not during construction.
 *
 * Must be called in an injection context (constructor or field initializer).
 *
 * ```ts
 * import { Component, signal } from "@angular/core";
 * import { useSlop } from "@slop-ai/angular";
 * import { slop } from "./slop";
 *
 * @Component({ ... })
 * export class NotesComponent {
 *   notes = signal<Note[]>([...]);
 *
 *   constructor() {
 *     // Static path
 *     useSlop(slop, "notes", () => ({
 *       type: "collection",
 *       props: { count: this.notes().length },
 *       items: this.notes().map(n => ({
 *         id: n.id,
 *         props: { title: n.title },
 *         actions: { delete: () => this.notes.update(prev => prev.filter(x => x.id !== n.id)) },
 *       })),
 *     }));
 *
 *     // Dynamic path (input signals — safe because afterRenderEffect is deferred)
 *     useSlop(slop, () => this.activeView()?.id ?? "fallback", () => ({ ... }));
 *   }
 * }
 * ```
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string | (() => string),
  descriptor: () => NodeDescriptor
): void {
  const destroyRef = inject(DestroyRef);
  let currentPath: string | null = null;

  // afterRenderEffect runs AFTER rendering completes — input signals are
  // guaranteed to be set. It re-runs when tracked signal dependencies change.
  afterRenderEffect(() => {
    const p = resolvePath(path);
    const desc = descriptor();

    if (currentPath !== null && p !== currentPath) {
      client.unregister(currentPath);
    }
    currentPath = p;

    client.register(currentPath, deepUnwrap(desc) as NodeDescriptor);
  });

  destroyRef.onDestroy(() => {
    if (currentPath !== null) {
      client.unregister(currentPath);
    }
  });
}

function resolvePath(path: string | (() => string)): string {
  return typeof path === "function" ? path() : path;
}

/**
 * Recursively strip reactive wrappers while preserving functions
 * (action handlers).
 */
function deepUnwrap(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (typeof obj === "function") return obj;
  if (Array.isArray(obj)) return obj.map(deepUnwrap);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    out[key] = typeof val === "function" ? val : deepUnwrap(val);
  }
  return out;
}

export { action } from "@slop-ai/core";
