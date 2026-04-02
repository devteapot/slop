---
title: Vue
description: How to use SLOP with Vue to expose component state to AI agents.
---

## Installation

```bash
bun add @slop-ai/client @slop-ai/vue
```

## Setup

Create a SLOP client instance for your app:

```ts
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "notes-app",
  name: "Notes App",
});
```

## Using `useSlop`

The `useSlop` composable registers a node on mount, updates it reactively, and unregisters it on unmount.

```ts
import { useSlop } from "@slop-ai/vue";
```

The signature is `useSlop(client, path, () => descriptor)` where the descriptor is wrapped in a function so Vue can track reactive dependencies.

## Full Example

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useSlop } from "@slop-ai/vue";
import { slop } from "./slop";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
}

const notes = ref<Note[]>([]);

useSlop(slop, "/notes", () => ({
  type: "collection",
  props: { count: notes.value.length },
  items: notes.value,
  actions: {
    create: {
      params: { title: "string" },
      handler: ({ title }: { title: string }) => {
        notes.value.push({
          id: crypto.randomUUID(),
          title,
          pinned: false,
        });
      },
    },
    togglePin: ({ id }: { id: string }) => {
      const note = notes.value.find((n) => n.id === id);
      if (note) note.pinned = !note.pinned;
    },
    clearAll: {
      handler: () => {
        notes.value = [];
      },
      dangerous: true,
    },
  },
}));
</script>

<template>
  <ul>
    <li v-for="note in notes" :key="note.id">
      {{ note.pinned ? "📌 " : "" }}{{ note.title }}
    </li>
  </ul>
</template>
```

## Next Steps

- [Vue package API](/api/vue)
- [Browser provider API](/api/client)
- [Core helper types](/api/core)
