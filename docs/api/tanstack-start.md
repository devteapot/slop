# @slop-ai/tanstack-start

`@slop-ai/tanstack-start` bridges a server-owned provider and a browser-owned UI provider into one public SLOP surface.

```bash
bun add @slop-ai/server @slop-ai/tanstack-start
```

## Client-side exports

### `useSlopUI()`

Call this once in your root layout to bootstrap the browser-side UI provider and route metadata.

### `useSlop(path, descriptor)`

Use this inside route components to expose page-local UI state under the mounted `ui` subtree.

### `createSlopMiddleware(id?)`

Use this in TanStack Start server functions to refresh the provider automatically after mutations.

## Server-side exports

Import these from `@slop-ai/tanstack-start/server`:

- `createSlopServer()`
- `sharedState()`
- `createSlopRefreshFn()`
- `createWebSocketHandler()`
- `slopVitePlugin()`
- `WebSocketServer`

## Architecture

- the public provider stays on the server
- browser UI state connects back over a hidden socket
- the server mounts that UI tree under `ui`
- consumers only need to connect to one provider

## Related pages

- [TanStack Start guide](/guides/tanstack-start)
- [Server provider](/api/server)
- [React adapter](/api/react)
