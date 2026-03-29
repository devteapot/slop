---
title: "@slop-ai/react"
description: API reference for the SLOP React hook
---

React hook for registering SLOP nodes in components.

```bash
bun add @slop-ai/react @slop-ai/core
```

## `useSlop(client, path, descriptor)`

Registers a SLOP node for the lifetime of the component. Re-registers on every render (so handlers always close over fresh state). Unregisters on unmount.

```tsx
import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";

function MyComponent() {
  const [data, setData] = useState([...]);

  useSlop(slop, "my-data", {
    type: "collection",
    props: { count: data.length },
    items: data.map(d => ({
      id: d.id,
      props: { name: d.name },
      actions: { remove: () => setData(prev => prev.filter(x => x.id !== d.id)) },
    })),
  });

  return <div>...</div>;
}
```

### Parameters

| Param | Type | Description |
|---|---|---|
| `client` | `SlopClient` | The client from `createSlop()` or a scoped client |
| `path` | `string` | Node path in the tree (e.g., `"inbox/messages"`) |
| `descriptor` | `NodeDescriptor` | The node descriptor (props, actions, items, etc.) |

### Behavior

- Calls `client.register(path, descriptor)` on every render
- Calls `client.unregister(path)` on unmount
- Handles path changes (unregisters old path, registers new)
- Compatible with React strict mode
- JSX is completely SLOP-free — the hook is the only SLOP code in the component
