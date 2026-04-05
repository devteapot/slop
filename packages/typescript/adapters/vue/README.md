# `@slop-ai/vue`

Vue composable for exposing reactive state to SLOP.

## Install

```bash
bun add @slop-ai/client @slop-ai/vue
```

## Quick start

```vue
<script setup lang="ts">
import { ref } from "vue";
import { createSlop } from "@slop-ai/client";
import { action, useSlop } from "@slop-ai/vue";

const slop = createSlop({ id: "notes-app", name: "Notes App" });
const notes = ref([{ id: "1", title: "Ship docs", pinned: false }]);

useSlop(slop, "notes", () => ({
  type: "collection",
  props: { count: notes.value.length },
  items: notes.value.map((note) => ({
    id: note.id,
    props: { title: note.title, pinned: note.pinned },
    actions: {
      toggle_pin: action(() => {
        notes.value = notes.value.map((item) =>
          item.id === note.id ? { ...item, pinned: !item.pinned } : item,
        );
      }),
    },
  })),
}));
</script>
```

The descriptor function is tracked reactively, and Vue proxies are unwrapped before the descriptor is sent to the transport layer.

## Documentation

- API reference: https://docs.slopai.dev/api/vue
- Vue guide: https://docs.slopai.dev/guides/vue
- Browser provider: https://docs.slopai.dev/api/client
