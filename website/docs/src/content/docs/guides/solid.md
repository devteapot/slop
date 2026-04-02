---
title: Solid
description: How to use SLOP with SolidJS to expose component state to AI agents.
---

## Installation

```bash
bun add @slop-ai/client @slop-ai/solid
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

The `useSlop` primitive registers a node on mount, updates it reactively, and unregisters it on cleanup.

```ts
import { useSlop } from "@slop-ai/solid";
```

The signature is `useSlop(client, path, () => descriptor)` where the descriptor is wrapped in a function so Solid can track signal dependencies.

## Full Example

```tsx
import { createSignal } from "solid-js";
import { useSlop } from "@slop-ai/solid";
import { slop } from "./slop";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
}

export function Notes() {
  const [notes, setNotes] = createSignal<Note[]>([]);

  useSlop(slop, "/notes", () => ({
    type: "collection",
    props: { count: notes().length },
    items: notes(),
    actions: {
      create: {
        params: { title: "string" },
        handler: ({ title }: { title: string }) => {
          setNotes((prev) => [
            ...prev,
            { id: crypto.randomUUID(), title, pinned: false },
          ]);
        },
      },
      togglePin: ({ id }: { id: string }) => {
        setNotes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n))
        );
      },
      clearAll: {
        handler: () => setNotes([]),
        dangerous: true,
      },
    },
  }));

  return (
    <ul>
      {notes().map((note) => (
        <li>
          {note.pinned ? "📌 " : ""}
          {note.title}
        </li>
      ))}
    </ul>
  );
}
```

## Next Steps

- [Solid package API](/api/solid)
- [Browser provider API](/api/client)
- [Core helper types](/api/core)
