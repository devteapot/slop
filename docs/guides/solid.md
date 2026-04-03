# Solid

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
import { action, useSlop } from "@slop-ai/solid";
```

The signature is `useSlop(client, pathOrGetter, descriptorFactory)` where the descriptor is wrapped in a function so Solid can track signal dependencies.

## Full Example

```tsx
import { createSignal } from "solid-js";
import { action, useSlop } from "@slop-ai/solid";
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
    actions: {
      create: action({ title: "string" }, ({ title }) => {
        setNotes((prev) => [
          ...prev,
          { id: crypto.randomUUID(), title, pinned: false },
        ]);
      }),
      clear_all: action(() => setNotes([]), { dangerous: true }),
    },
    items: notes().map((note) => ({
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
