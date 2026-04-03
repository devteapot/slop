import { useEffect } from "react";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

/**
 * React hook that registers a SLOP node for this component.
 *
 * Call it near your state declarations — NOT in the JSX.
 * The node is registered on every render (so handlers always close over fresh state)
 * and unregistered when the component unmounts.
 *
 * ```tsx
 * import { createSlop } from "@slop-ai/client";
 * import { useSlop } from "@slop-ai/react";
 *
 * const slop = createSlop({ id: "my-app", name: "My App" });
 *
 * function NotesList() {
 *   const [notes, setNotes] = useState([...]);
 *
 *   useSlop(slop, "notes", () => ({
 *     type: "collection",
 *     props: { count: notes.length },
 *     items: notes.map(n => ({
 *       id: n.id,
 *       props: { title: n.title },
 *       actions: { delete: () => setNotes(prev => prev.filter(x => x.id !== n.id)) },
 *     })),
 *   }));
 *
 *   return <ul>{notes.map(n => <li key={n.id}>{n.title}</li>)}</ul>;
 * }
 * ```
 *
 * @param client - The SlopClient instance (from `createSlop()` or a scoped client)
 * @param path - The node's path in the tree or a getter for a dynamic path
 * @param descriptor - A factory that returns the node descriptor (props, actions, items, children)
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string | (() => string),
  descriptor: () => NodeDescriptor
): void {
  useEffect(() => {
    const resolvedPath = resolvePath(path);
    client.register(resolvedPath, descriptor());
    return () => {
      client.unregister(resolvedPath);
    };
  });
}

function resolvePath(path: string | (() => string)): string {
  return typeof path === "function" ? path() : path;
}

export { action } from "@slop-ai/core";
