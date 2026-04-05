import { watchEffect, onUnmounted, toRaw } from "vue";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

/**
 * Vue composable that registers a SLOP node.
 *
 * Accepts a static or dynamic path (`string` or `() => string`).
 * The descriptor function is called reactively — when any `ref`/`reactive`
 * dependency inside it changes, the node is re-registered automatically.
 *
 * Vue reactive Proxies are deep-stripped via `toRaw()` before reaching
 * the protocol layer (which uses `structuredClone`/`postMessage`).
 *
 * ```vue
 * <script setup>
 * import { ref } from "vue";
 * import { useSlop } from "@slop-ai/vue";
 * import { slop } from "./slop";
 *
 * const notes = ref([...]);
 *
 * // Static path
 * useSlop(slop, "notes", () => ({
 *   type: "collection",
 *   props: { count: notes.value.length },
 *   items: notes.value.map(n => ({
 *     id: n.id,
 *     props: { title: n.title },
 *     actions: { delete: () => notes.value = notes.value.filter(x => x.id !== n.id) },
 *   })),
 * }));
 *
 * // Dynamic path
 * useSlop(slop, () => activeView.value ?? "fallback", () => ({ ... }));
 * </script>
 * ```
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string | (() => string),
  descriptor: () => NodeDescriptor
): void {
  let currentPath = resolvePath(path);

  watchEffect(() => {
    const p = resolvePath(path);
    const desc = descriptor();

    if (p !== currentPath) {
      client.unregister(currentPath);
      currentPath = p;
    }

    client.register(currentPath, deepUnwrap(desc) as NodeDescriptor);
  }, { flush: "post" });

  onUnmounted(() => {
    client.unregister(currentPath);
  });
}

function resolvePath(path: string | (() => string)): string {
  return typeof path === "function" ? path() : path;
}

/**
 * Recursively strip Vue reactive Proxies from data while preserving
 * functions (action handlers). Uses Vue's own `toRaw()` at each level.
 */
function deepUnwrap(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (typeof obj === "function") return obj;

  const raw = toRaw(obj);

  if (Array.isArray(raw)) return raw.map(deepUnwrap);

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    const val = (raw as Record<string, unknown>)[key];
    out[key] = typeof val === "function" ? val : deepUnwrap(val);
  }
  return out;
}

export { action } from "@slop-ai/core";
