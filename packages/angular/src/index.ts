import { effect, DestroyRef, inject } from "@angular/core";
import type { SlopClient, NodeDescriptor } from "@slop/core";

/**
 * Angular function that registers a SLOP node.
 *
 * Uses Angular 16+ signals `effect()` for reactivity and `DestroyRef`
 * for cleanup. Must be called in an injection context (constructor or field initializer).
 *
 * ```ts
 * import { Component, signal } from "@angular/core";
 * import { useSlop } from "@slop/angular";
 * import { slop } from "./slop";
 *
 * @Component({ ... })
 * export class NotesComponent {
 *   notes = signal<Note[]>([...]);
 *
 *   constructor() {
 *     useSlop(slop, "notes", () => ({
 *       type: "collection",
 *       props: { count: this.notes().length },
 *       items: this.notes().map(n => ({
 *         id: n.id,
 *         props: { title: n.title },
 *         actions: { delete: () => this.notes.update(prev => prev.filter(x => x.id !== n.id)) },
 *       })),
 *     }));
 *   }
 * }
 * ```
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string,
  descriptor: () => NodeDescriptor
): void {
  effect(() => {
    client.register(path as any, descriptor());
  });
  inject(DestroyRef).onDestroy(() => {
    client.unregister(path as any);
  });
}
