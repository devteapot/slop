---
title: "Angular"
description: "How to use SLOP with Angular to expose component state to AI agents."
---
## Installation

```bash
bun add @slop-ai/client @slop-ai/angular
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

The `useSlop` function is called in the constructor. It registers a node using Angular signals for reactivity and unregisters it on destroy.

```ts
import { action, useSlop } from "@slop-ai/angular";
```

The signature is `useSlop(client, pathOrGetter, descriptorFactory)` where the descriptor function is re-evaluated whenever the signals it reads change.

## Full Example

```ts
import { Component, signal, computed } from "@angular/core";
import { action, useSlop } from "@slop-ai/angular";
import { slop } from "./slop";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
}

@Component({
  selector: "app-notes",
  template: `
    <ul>
      @for (note of notes(); track note.id) {
        <li>{{ note.pinned ? "📌 " : "" }}{{ note.title }}</li>
      }
    </ul>
  `,
})
export class NotesComponent {
  notes = signal<Note[]>([]);

  constructor() {
    useSlop(slop, "/notes", () => ({
      type: "collection",
      props: { count: this.notes().length },
      actions: {
        create: action({ title: "string" }, ({ title }) => {
          this.notes.update((prev) => [
            ...prev,
            { id: crypto.randomUUID(), title, pinned: false },
          ]);
        }),
        clear_all: action(() => this.notes.set([]), { dangerous: true }),
      },
      items: this.notes().map((note) => ({
        id: note.id,
        props: { title: note.title, pinned: note.pinned },
        actions: {
          toggle_pin: action(() => {
            this.notes.update((prev) =>
              prev.map((entry) =>
                entry.id === note.id ? { ...entry, pinned: !entry.pinned } : entry,
              ),
            );
          }),
        },
      })),
    }));
  }
}
```

## Next Steps

- [Angular package API](/api/angular)
- [Browser provider API](/api/client)
- [Core helper types](/api/core)
