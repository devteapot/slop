# Full-Stack Apps

When a web app has both a server and a browser frontend, the server is the natural SLOP endpoint — it holds authoritative data and is always reachable. But the browser owns UI state (selected item, form values, route). The full-stack pattern merges both into a single provider.

## The pattern

1. **Server creates the SLOP provider** and registers data nodes (collections, settings, etc.)
2. **Browser connects back to the server** as a SLOP provider over WebSocket, using `?slop_role=provider&mount=ui`
3. **Server mounts the browser tree** under a `ui` path in its own tree
4. **Consumers see one tree** with both `data` and `ui` subtrees

```
Consumer connects to server
         |
    [server tree]
    /           \
contacts       ui          <-- mounted from browser
  |          /     \
 ...     search   compose
```

## Server side

The server's WebSocket endpoint needs to handle two kinds of connections:

- **Consumer connections** (default) — subscribe to the tree, invoke actions
- **Provider connections** (`?slop_role=provider`) — the browser sends its UI tree, the server mounts it

When a provider connection arrives, the server:

1. Sends a `connect` message to the browser
2. Receives `hello` + subscribes to the browser's full tree
3. On `snapshot`, registers the browser tree as a local node at the mount path
4. On `patch`, applies patches to the local copy and calls `refresh()`
5. On action invokes targeting UI nodes, forwards the `invoke` to the browser

Any server SDK can implement this. The messages are standard SLOP protocol — `connect`, `subscribe`, `snapshot`, `patch`, `invoke`, `result`.

## Browser side

The browser creates a SLOP client that connects to the server as a provider:

```ts
import { createSlop } from "@slop-ai/client";

const slop = createSlop({
  id: "my-ui",
  name: "My UI",
  transports: ["websocket"],
  websocketUrl: "ws://localhost:8000/slop?slop_role=provider&mount=ui",
  websocketDiscover: false,
});
```

Use `transports: ["websocket"]` (no `postmessage`) to avoid the browser extension seeing a duplicate in-page provider. The extension discovers the server's `ws://` endpoint via the `<meta name="slop">` tag and connects there — which already includes the mounted UI.

```html
<meta name="slop" content="ws://localhost:8000/slop" />
```

## Data invalidation

When an AI consumer invokes a server-side action, the server tree updates automatically. But the browser frontend is fetching data independently (via REST, loaders, etc.) and doesn't know the data changed.

A common convention is to register an `__adapter` node with a `refresh` action on the browser side:

```ts
slop.register("__adapter", {
  type: "context",
  actions: {
    refresh: () => refetchData(),
  },
});
```

After handling a server-side invoke, the server can forward an invoke for `__adapter.refresh` back to the browser through the mounted UI session, triggering a data refetch. This keeps the browser UI in sync without polling.

The `__adapter` node is a convention, not part of the protocol spec. Framework adapters like `@slop-ai/tanstack-start` handle this automatically.

## Framework adapters vs manual setup

`@slop-ai/tanstack-start` implements this pattern out of the box:

- `useSlopUI()` creates the browser provider and connects back
- `createWebSocketHandler()` handles both consumer and provider connections
- `createSlopMiddleware()` auto-refreshes after server mutations
- `UiMountSession` manages the mounted browser tree
- Route tracking and `__adapter.refresh` are registered automatically

For other stacks (e.g. Python + React, Go + Vue), you implement the same pattern manually. See [examples/full-stack/python-react](https://github.com/devteapot/slop/tree/main/examples/full-stack/python-react) for a working example with FastAPI and React.

## Related pages

- [TanStack Start guide](/guides/tanstack-start)
- [Server & Native Apps](/guides/server-apps)
- [React guide](/guides/react)
