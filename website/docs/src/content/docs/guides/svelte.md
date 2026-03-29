---
title: Svelte
description: How to use SLOP with Svelte to expose component state to AI agents.
---

## Installation

Svelte does not need a dedicated adapter. Use `@slop-ai/core` directly with Svelte's `$effect` and `onDestroy`.

```bash
npm install @slop-ai/core
```

## Setup

Create a SLOP client instance for your app:

```ts
import { createSlop } from "@slop-ai/core";

export const slop = createSlop({
  id: "notes-app",
  name: "Notes App",
});
```

## Pattern

Use `$effect` to register/update the node whenever reactive state changes, and `onDestroy` to unregister it when the component is destroyed.

## Full Example

```svelte
<script lang="ts">
  import { onDestroy } from "svelte";
  import { slop } from "./slop";

  interface Note {
    id: string;
    title: string;
    pinned: boolean;
  }

  let notes = $state<Note[]>([]);

  $effect(() => {
    slop.register("/notes", {
      type: "collection",
      props: { count: notes.length },
      items: notes,
      actions: {
        create: {
          params: { title: "string" },
          handler: ({ title }: { title: string }) => {
            notes = [
              ...notes,
              { id: crypto.randomUUID(), title, pinned: false },
            ];
          },
        },
        togglePin: ({ id }: { id: string }) => {
          notes = notes.map((n) =>
            n.id === id ? { ...n, pinned: !n.pinned } : n
          );
        },
        clearAll: {
          handler: () => {
            notes = [];
          },
          dangerous: true,
        },
      },
    });
  });

  onDestroy(() => {
    slop.unregister("/notes");
  });
</script>

<ul>
  {#each notes as note (note.id)}
    <li>{note.pinned ? "📌 " : ""}{note.title}</li>
  {/each}
</ul>
```

## Next Steps

See the [API Reference](/reference/core/) for the full node descriptor format and client options.
