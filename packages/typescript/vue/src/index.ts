import { watchEffect, onUnmounted } from "vue";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

/**
 * Vue composable that registers a SLOP node.
 *
 * The descriptor function is called reactively — when any ref/reactive
 * dependency inside it changes, the node is re-registered automatically.
 *
 * ```vue
 * <script setup>
 * import { ref } from "vue";
 * import { useSlop } from "@slop-ai/vue";
 * import { slop } from "./slop";
 *
 * const notes = ref([...]);
 *
 * useSlop(slop, "notes", () => ({
 *   type: "collection",
 *   props: { count: notes.value.length },
 *   items: notes.value.map(n => ({
 *     id: n.id,
 *     props: { title: n.title },
 *     actions: { delete: () => notes.value = notes.value.filter(x => x.id !== n.id) },
 *   })),
 * }));
 * </script>
 * ```
 */
export function useSlop<S = unknown>(
  client: SlopClient<S>,
  path: string,
  descriptor: () => NodeDescriptor
): void {
  watchEffect(() => {
    // JSON round-trip strips Vue reactive proxies before entering the protocol layer.
    client.register(path as any, JSON.parse(JSON.stringify(descriptor())));
  });
  onUnmounted(() => {
    client.unregister(path as any);
  });
}
