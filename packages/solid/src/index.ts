import { createEffect, onCleanup } from "solid-js";
import type { SlopClient, NodeDescriptor } from "@slop/core";

/**
 * SolidJS primitive that registers a SLOP node.
 *
 * The descriptor function is called reactively — when any signal
 * inside it changes, the node is re-registered automatically.
 *
 * ```tsx
 * import { createSignal } from "solid-js";
 * import { useSlop } from "@slop/solid";
 * import { slop } from "./slop";
 *
 * function NotesList() {
 *   const [notes, setNotes] = createSignal([...]);
 *
 *   useSlop(slop, "notes", () => ({
 *     type: "collection",
 *     props: { count: notes().length },
 *     items: notes().map(n => ({
 *       id: n.id,
 *       props: { title: n.title },
 *       actions: { delete: () => setNotes(prev => prev.filter(x => x.id !== n.id)) },
 *     })),
 *   }));
 *
 *   return <div>{notes().map(n => <div>{n.title}</div>)}</div>;
 * }
 * ```
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string,
  descriptor: () => NodeDescriptor
): void {
  createEffect(() => {
    client.register(path as any, descriptor());
  });
  onCleanup(() => {
    client.unregister(path as any);
  });
}
