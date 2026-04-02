# `@slop-ai/solid`

SolidJS primitive for exposing signal-driven state to SLOP.

## Install

```bash
bun add @slop-ai/client @slop-ai/solid
```

## Quick start

```tsx
import { createSignal } from "solid-js";
import { createSlop } from "@slop-ai/client";
import { action, useSlop } from "@slop-ai/solid";

const slop = createSlop({ id: "notes-app", name: "Notes App" });

export function NotesList() {
  const [notes] = createSignal([{ id: "1", title: "Ship docs", pinned: false }]);

  useSlop(slop, "notes", () => ({
    type: "collection",
    props: { count: notes().length },
    items: notes().map((note) => ({
      id: note.id,
      props: { title: note.title, pinned: note.pinned },
      actions: {
        toggle_pin: action(() =>
          setNotes((current) =>
            current.map((item) =>
              item.id === note.id ? { ...item, pinned: !item.pinned } : item,
            ),
          ),
        ),
      },
    })),
  }));

  return null;
}
```

`useSlop()` tracks Solid signals used inside the descriptor and re-registers automatically when they change.

## Documentation

- API reference: https://docs.slopai.dev/api/solid
- Solid guide: https://docs.slopai.dev/guides/solid
- Browser provider: https://docs.slopai.dev/api/client
