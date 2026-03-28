import { useEffect, useRef } from "react";
import { BrowserSlopProvider, type SlopNode } from "./slop-provider";

interface UseSlopOptions {
  id: string;
  name: string;
  tree: () => SlopNode;
  handlers: Record<string, (params: Record<string, unknown>, path: string) => unknown>;
}

/**
 * React hook that sets up a SLOP provider.
 * - `tree` is called on every render to get the current state tree
 * - `handlers` maps action names to callbacks
 */
export function useSlop({ id, name, tree, handlers }: UseSlopOptions) {
  const providerRef = useRef<BrowserSlopProvider | null>(null);

  // Initialize once
  if (!providerRef.current) {
    const p = new BrowserSlopProvider({ id, name });
    for (const [action, handler] of Object.entries(handlers)) {
      p.onInvoke(action, handler);
    }
    p.start();
    providerRef.current = p;
  }

  // Update tree on every render (React re-renders on state change)
  useEffect(() => {
    providerRef.current?.setTree(tree());
  });

  // Cleanup
  useEffect(() => {
    return () => {
      providerRef.current?.stop();
    };
  }, []);

  // Update handlers (they may close over fresh state)
  useEffect(() => {
    const p = providerRef.current;
    if (!p) return;
    for (const [action, handler] of Object.entries(handlers)) {
      p.onInvoke(action, handler);
    }
  });

  return providerRef.current;
}
