---
title: Angular
description: How to use SLOP with Angular to expose component state to AI agents.
---

## Installation

```bash
npm install @slop-ai/core @slop-ai/angular
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

## Using `useSlop`

The `useSlop` function is called in the constructor. It registers a node using Angular signals for reactivity and unregisters it on destroy.

```ts
import { useSlop } from "@slop-ai/angular";
```

The signature is `useSlop(client, path, () => descriptor)` where the descriptor function is re-evaluated whenever the signals it reads change.

## Full Example

```ts
import { Component, signal, computed } from "@angular/core";
import { useSlop } from "@slop-ai/angular";
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
      items: this.notes(),
      actions: {
        create: {
          params: { title: "string" },
          handler: ({ title }: { title: string }) => {
            this.notes.update((prev) => [
              ...prev,
              { id: crypto.randomUUID(), title, pinned: false },
            ]);
          },
        },
        togglePin: ({ id }: { id: string }) => {
          this.notes.update((prev) =>
            prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n))
          );
        },
        clearAll: {
          handler: () => this.notes.set([]),
          dangerous: true,
        },
      },
    }));
  }
}
```

## Next Steps

See the [API Reference](/reference/core/) for the full node descriptor format and client options.
