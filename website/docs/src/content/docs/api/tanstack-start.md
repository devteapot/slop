---
title: "@slop-ai/tanstack-start"
description: "Full-stack SLOP adapter for TanStack Start applications"
---
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

- `createSlopServer()` — singleton-safe server instance (survives Vite module env duplication)
- `sharedState()` — development-time state that survives Vite module reloads
- `createSlopRefreshFn()` — middleware callback that refreshes the tree and mounted UI after mutations
- `createWebSocketHandler()` — h3/CrossWS handler for both consumer and provider connections
- `slopVitePlugin()` — Vite plugin that attaches the WebSocket endpoint
- `WebSocketServer` — re-exported from `ws` for convenience

### UI mount internals

These are used by `createWebSocketHandler` internally but can be imported for advanced use cases:

- `registerUiMountSession(slop, mountPath, session)` — register a mount session, replacing any existing one at the same path
- `unregisterUiMountSession(slop, mountPath, session)` — remove a mount session
- `refreshMountedUi(slop, options?)` — invoke `__adapter.refresh` on all mounted browser sessions. Pass `{ skipPath }` to skip sessions whose mount path matches the invoke source (prevents circular refresh)

## Architecture

- the public provider stays on the server
- browser UI state connects back over a hidden socket
- the server mounts that UI tree under `ui`
- consumers only need to connect to one provider

## Related pages

- [TanStack Start guide](/guides/tanstack-start)
- [Server provider](/api/server)
- [React adapter](/api/react)
