---
title: React
description: How to use SLOP with React to expose component state to AI agents.
---

## Installation

```bash
npm install @slop-ai/client @slop-ai/react
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

The `useSlop` hook registers a node on mount, updates it on every render, and unregisters it on unmount.

```tsx
import { useSlop } from "@slop-ai/react";
```

The signature is `useSlop(client, path, descriptor)` where `descriptor` is a plain object (React re-runs the hook on every render, so a function wrapper is not needed).

## Full Example

```tsx
import { useState } from "react";
import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
}

export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);

  useSlop(slop, "/notes", {
    type: "collection",
    props: { count: notes.length },
    items: notes,
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
  });

  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id}>
          {note.pinned ? "📌 " : ""}
          {note.title}
        </li>
      ))}
    </ul>
  );
}
```

## Next Steps

See the [API Reference](/reference/core/) for the full node descriptor format and client options.
