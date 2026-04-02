# `@slop-ai/react`

React hook for exposing component state to SLOP.

## Install

```bash
bun add @slop-ai/client @slop-ai/react
```

## Quick start

```tsx
import { createSlop } from "@slop-ai/client";
import { useSlop } from "@slop-ai/react";

const slop = createSlop({ id: "notes-app", name: "Notes App" });

export function NotesList() {
  const [notes, setNotes] = useState([{ id: "1", title: "Ship docs", pinned: false }]);

  useSlop(slop, "notes", {
    type: "collection",
    props: { count: notes.length },
    items: notes.map((note) => ({
      id: note.id,
      props: { title: note.title, pinned: note.pinned },
      actions: {
        toggle_pin: () =>
          setNotes((current) =>
            current.map((item) =>
              item.id === note.id ? { ...item, pinned: !item.pinned } : item,
            ),
          ),
      },
    })),
  });

  return null;
}
```

`useSlop()` registers on render and unregisters on unmount, so action handlers always close over fresh component state.

## Documentation

- API reference: https://docs.slopai.dev/api/react
- React guide: https://docs.slopai.dev/guides/react
- Browser provider: https://docs.slopai.dev/api/client
