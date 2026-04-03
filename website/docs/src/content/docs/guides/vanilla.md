---
title: "Vanilla JS"
description: "How to use SLOP with plain JavaScript or TypeScript without a framework."
---
## Installation

No adapter is needed. Use `@slop-ai/client` directly.

```bash
bun add @slop-ai/client
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

## Pattern

Call `slop.register(path, descriptor)` to publish a node and `slop.unregister(path)` to remove it. Re-call `register` with the same path to update the descriptor.

## Full Example

```ts
import { createSlop } from "@slop-ai/client";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
}

const slop = createSlop({ id: "notes-app", name: "Notes App" });

let notes: Note[] = [];

function syncSlop() {
  slop.register("/notes", {
    type: "collection",
    props: { count: notes.length },
    items: notes,
    actions: {
      create: {
        params: { title: "string" },
        handler: ({ title }: { title: string }) => {
          notes.push({ id: crypto.randomUUID(), title, pinned: false });
          syncSlop();
        },
      },
      togglePin: ({ id }: { id: string }) => {
        const note = notes.find((n) => n.id === id);
        if (note) note.pinned = !note.pinned;
        syncSlop();
      },
      clearAll: {
        handler: () => {
          notes = [];
          syncSlop();
        },
        dangerous: true,
      },
    },
  });
}

// Initial registration
syncSlop();

// Clean up when done
// slop.unregister("/notes");
```

## Next Steps

- [Browser provider API](/api/client)
- [Core helper types](/api/core)
