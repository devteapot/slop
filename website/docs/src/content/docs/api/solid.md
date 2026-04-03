---
title: "@slop-ai/solid"
description: "SolidJS primitive for registering SLOP state from signals"
---
```bash
bun add @slop-ai/client @slop-ai/solid
```

## `useSlop(client, pathOrGetter, descriptorFactory)`

`useSlop()` accepts a static or dynamic path plus a descriptor factory tracked by Solid's reactive system.

```tsx
useSlop(slop, "notes", () => ({
  type: "collection",
  props: { count: notes().length },
  items: notes().map((note) => ({
    id: note.id,
    props: { title: note.title, pinned: note.pinned },
  })),
}));
```

When signals used inside the descriptor change, the node is re-registered automatically.

## Related pages

- [Solid guide](/guides/solid)
- [Browser provider](/api/client)
