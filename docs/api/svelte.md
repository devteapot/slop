# @slop-ai/svelte

```bash
bun add @slop-ai/client @slop-ai/svelte
```

## `useSlop(client, pathOrGetter, descriptorFactory)`

The Svelte adapter is published as a `.svelte.ts` entrypoint so rune syntax stays intact for downstream compilation.

```svelte
<script lang="ts">
  useSlop(slop, "notes", () => ({
    type: "collection",
    props: { count: notes.length },
  }));
</script>
```

The adapter tracks `$state` dependencies inside the descriptor and unregisters automatically on component destroy.

## Related pages

- [Svelte guide](/guides/svelte)
- [Browser provider](/api/client)
