# @slop-ai/vue

```bash
bun add @slop-ai/client @slop-ai/vue
```

## `useSlop(client, pathOrGetter, descriptorFactory)`

`useSlop()` accepts either a static path string or a path factory, plus a descriptor factory that is tracked reactively.

```ts
useSlop(slop, "notes", () => ({
  type: "collection",
  props: { count: notes.value.length },
  items: notes.value.map((note) => ({
    id: note.id,
    props: { title: note.title, pinned: note.pinned },
  })),
}));
```

The implementation flushes after render and unwraps Vue proxies before the descriptor is sent to the transport layer.

## Related pages

- [Vue guide](/guides/vue)
- [Browser provider](/api/client)
