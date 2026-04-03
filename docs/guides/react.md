# React

## Installation

```bash
bun add @slop-ai/client @slop-ai/react
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
import { action, useSlop } from "@slop-ai/react";
```

The signature is `useSlop(client, pathOrGetter, descriptorFactory)`. React registers after commit, re-runs the descriptor factory on every render, and cleans up automatically on unmount.

## Full Example

```tsx
import { useState } from "react";
import { action, useSlop } from "@slop-ai/react";
import { slop } from "./slop";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
}

export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);

  useSlop(slop, "/notes", () => ({
    type: "collection",
    props: { count: notes.length },
    actions: {
      create: action({ title: "string" }, ({ title }) => {
        setNotes((prev) => [
          ...prev,
          { id: crypto.randomUUID(), title, pinned: false },
        ]);
      }),
      clear_all: action(() => setNotes([]), { dangerous: true }),
    },
    items: notes.map((note) => ({
      id: note.id,
      props: { title: note.title, pinned: note.pinned },
      actions: {
        toggle_pin: action(() => {
          setNotes((prev) =>
            prev.map((entry) =>
              entry.id === note.id ? { ...entry, pinned: !entry.pinned } : entry,
            ),
          );
        }),
      },
    })),
  }));

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

- [React package API](/api/react)
- [Browser provider API](/api/client)
- [Core helper types](/api/core)
