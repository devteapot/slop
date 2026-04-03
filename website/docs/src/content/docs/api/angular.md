---
title: "@slop-ai/angular"
description: Angular integration for exposing signal-based component state through SLOP
---

```bash
bun add @slop-ai/client @slop-ai/angular
```

## `useSlop(client, pathOrGetter, descriptorFactory)`

Call `useSlop()` inside an Angular 19+ injection context such as a constructor or field initializer.

```ts
constructor() {
  useSlop(slop, "notes", () => ({
    type: "collection",
    props: { count: this.notes().length },
  }));
}
```

The implementation uses `afterRenderEffect()` so Angular input signals are initialized before descriptor reads happen.

## Related pages

- [Angular guide](/guides/angular)
- [Browser provider](/api/client)
