# `@slop-ai/angular`

Angular 19+ integration for exposing signal-based component state to SLOP.

## Install

```bash
bun add @slop-ai/client @slop-ai/angular
```

## Quick start

```ts
import { Component, signal } from "@angular/core";
import { createSlop } from "@slop-ai/client";
import { action, useSlop } from "@slop-ai/angular";

const slop = createSlop({ id: "notes-app", name: "Notes App" });

@Component({
  selector: "app-notes",
  template: "",
})
export class NotesComponent {
  readonly notes = signal([{ id: "1", title: "Ship docs", pinned: false }]);

  constructor() {
    useSlop(slop, "notes", () => ({
      type: "collection",
      props: { count: this.notes().length },
      items: this.notes().map((note) => ({
        id: note.id,
        props: { title: note.title, pinned: note.pinned },
        actions: {
          toggle_pin: action(() => {
            this.notes.update((current) =>
              current.map((item) =>
                item.id === note.id ? { ...item, pinned: !item.pinned } : item,
              ),
            );
          }),
        },
      })),
    }));
  }
}
```

Call `useSlop()` inside an Angular 19+ injection context such as a constructor or field initializer.

## Documentation

- API reference: https://docs.slopai.dev/api/angular
- Angular guide: https://docs.slopai.dev/guides/angular
- Browser provider: https://docs.slopai.dev/api/client
