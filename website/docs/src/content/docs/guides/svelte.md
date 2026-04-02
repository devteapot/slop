---
title: Svelte
description: How to use SLOP with Svelte 5 to expose component state to AI agents
---

## Installation

```bash
bun add @slop-ai/client @slop-ai/svelte
```

## Setup

Create a browser-side provider once and reuse it across components:

```ts
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "notes-app",
  name: "Notes App",
});
```

## Using `useSlop`

`@slop-ai/svelte` exports a Svelte 5 composable that tracks rune-based state and unregisters automatically on component destroy.

```svelte
<script lang="ts">
  import { useSlop } from "@slop-ai/svelte";
  import { slop } from "./slop";

  interface Note {
    id: string;
    title: string;
    pinned: boolean;
  }

  let notes = $state<Note[]>([]);

  useSlop(slop, "notes", () => ({
    type: "collection",
    props: { count: notes.length },
    items: notes.map((note) => ({
      id: note.id,
      props: { title: note.title, pinned: note.pinned },
      actions: {
        toggle_pin: () => {
          notes = notes.map((entry) =>
            entry.id === note.id ? { ...entry, pinned: !entry.pinned } : entry,
          );
        },
      },
    })),
  }));
</script>
```

## Why use the adapter?

The package publishes a `.svelte.ts` entrypoint so downstream Svelte tooling keeps compiling rune syntax correctly. You still author normal Svelte 5 code, but the adapter handles registration, updates, and cleanup in the right lifecycle.

## Next Steps

- [Svelte package API](/api/svelte)
- [Browser provider API](/api/client)
- [Core helper types](/api/core)
