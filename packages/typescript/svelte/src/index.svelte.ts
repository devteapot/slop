import { onDestroy } from "svelte";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

/**
 * Svelte 5 composable that registers a SLOP node.
 *
 * Accepts a static or dynamic path (`string` or `() => string`).
 * The descriptor function is called inside `$effect` — Svelte tracks
 * reactive `$state` dependencies and re-registers automatically.
 *
 * Svelte 5 `$state` Proxies are deep-stripped before reaching the
 * protocol layer (which uses `structuredClone`/`postMessage`).
 *
 * ```svelte
 * <script lang="ts">
 * import { useSlop } from "@slop-ai/svelte";
 * import { slop } from "./slop";
 *
 * let notes = $state([...]);
 *
 * // Static path
 * useSlop(slop, "notes", () => ({
 *   type: "collection",
 *   props: { count: notes.length },
 *   items: notes.map(n => ({
 *     id: n.id,
 *     props: { title: n.title },
 *     actions: { delete: () => notes = notes.filter(x => x.id !== n.id) },
 *   })),
 * }));
 *
 * // Dynamic path
 * useSlop(slop, () => activeView?.id ?? "fallback", () => ({ ... }));
 * </script>
 * ```
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string | (() => string),
  descriptor: () => NodeDescriptor,
): void {
  let currentPath = resolvePath(path);

  $effect(() => {
    const p = resolvePath(path);
    const desc = descriptor();

    if (p !== currentPath) {
      client.unregister(currentPath as any);
      currentPath = p;
    }

    client.register(currentPath as any, deepUnwrap(desc) as NodeDescriptor);
  });

  onDestroy(() => {
    client.unregister(currentPath as any);
  });
}

function resolvePath(path: string | (() => string)): string {
  return typeof path === "function" ? path() : path;
}

/**
 * Recursively strip Svelte 5 `$state` Proxies while preserving
 * functions (action handlers).
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
