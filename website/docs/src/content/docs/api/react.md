---
title: "@slop-ai/react"
description: React hook for registering SLOP state from components
---

`@slop-ai/react` provides a single hook, `useSlop()`, for registering component state with a browser-side SLOP provider.

```bash
bun add @slop-ai/react @slop-ai/client
```

## `useSlop(client, path, descriptor)`

Registers a SLOP node for the lifetime of the component. Re-registers on every render so handlers always close over fresh state, and unregisters on unmount.

```tsx
import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";

function MyComponent() {
  const [data, setData] = useState([{ id: "1", title: "Ship docs" }]);

  useSlop(slop, "items", {
    type: "collection",
    props: { count: data.length },
    items: data.map((item) => ({
      id: item.id,
      props: { title: item.title },
      actions: {
        remove: () => setData((current) => current.filter((entry) => entry.id !== item.id)),
      },
    })),
  });

  return null;
}
```

### Parameters

| Param | Type | Description |
| --- | --- | --- |
| `client` | `SlopClient` | the client returned by `createSlop()` |
| `path` | `string` | node path in the tree |
| `descriptor` | `NodeDescriptor` | descriptor object for the node |

## Related pages

- [React guide](/guides/react)
- [Browser provider](/api/client)
- [Core helpers](/api/core)
