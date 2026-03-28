import { useEffect, useRef } from "react";
import type { SlopClient, NodeDescriptor } from "@slop/core";

/**
 * React hook that registers a SLOP node for this component.
 *
 * Call it near your state declarations — NOT in the JSX.
 * The node is registered on every render (so handlers always close over fresh state)
 * and unregistered when the component unmounts.
 *
 * ```tsx
 * import { createSlop } from "@slop/core";
 * import { useSlop } from "@slop/react";
 *
 * const slop = createSlop({ id: "my-app", name: "My App" });
 *
 * function NotesList() {
 *   const [notes, setNotes] = useState([...]);
 *
 *   useSlop(slop, "notes", {
 *     type: "collection",
 *     props: { count: notes.length },
 *     items: notes.map(n => ({
 *       id: n.id,
 *       props: { title: n.title },
 *       actions: { delete: () => setNotes(prev => prev.filter(x => x.id !== n.id)) },
 *     })),
 *   });
 *
 *   return <ul>{notes.map(n => <li key={n.id}>{n.title}</li>)}</ul>;
 * }
 * ```
 *
 * @param client - The SlopClient instance (from `createSlop()` or a scoped client)
 * @param path - The node's path in the tree (e.g., "inbox/messages")
 * @param descriptor - The node descriptor (props, actions, items, children)
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string,
  descriptor: NodeDescriptor
): void {
  const pathRef = useRef(path);

  // Register/update on every render — descriptor contains fresh handlers
  client.register(path as any, descriptor);

  // Handle path changes: unregister old path
  if (pathRef.current !== path) {
    client.unregister(pathRef.current as any);
    pathRef.current = path;
  }

  // Unregister on unmount (or when path/client changes)
  useEffect(() => {
    // Re-register in effect to handle React strict mode (cleanup + re-run)
    client.register(path as any, descriptor);
    return () => {
      client.unregister(path as any);
    };
  }, [client, path]);
}
