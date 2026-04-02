# `@slop-ai/svelte`

Svelte 5 composable for exposing rune-based state to SLOP.

## Install

```bash
bun add @slop-ai/client @slop-ai/svelte
```

## Quick start

```svelte
<script lang="ts">
  import { createSlop } from "@slop-ai/client";
  import { useSlop } from "@slop-ai/svelte";

  const slop = createSlop({ id: "notes-app", name: "Notes App" });
  let notes = $state([{ id: "1", title: "Ship docs", pinned: false }]);

  useSlop(slop, "notes", () => ({
    type: "collection",
    props: { count: notes.length },
    items: notes.map((note) => ({
      id: note.id,
      props: { title: note.title, pinned: note.pinned },
    })),
  }));
</script>
```

The published artifact is a `.svelte.ts` entrypoint so downstream Svelte tooling can keep compiling rune syntax correctly.

## Documentation

- API reference: https://docs.slopai.dev/api/svelte
- Svelte guide: https://docs.slopai.dev/guides/svelte
- Browser provider: https://docs.slopai.dev/api/client
