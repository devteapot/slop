# `@slop-ai/tanstack-start`

Full-stack adapter for TanStack Start applications.

This package wires together server-owned SLOP state, browser-owned UI state, and automatic refresh after server mutations. The public provider stays on the server, while the browser UI tree is mounted under `ui`.

## Install

```bash
bun add @slop-ai/server @slop-ai/tanstack-start
```

## Quick start

```ts
// src/server/slop.ts
import { createSlopServer, sharedState } from "@slop-ai/tanstack-start/server";

const state = sharedState("my-app", { items: [] as string[] });

export const slop = createSlopServer({ id: "my-app", name: "My App" });

slop.register("items", () => ({
  type: "collection",
  props: { count: state.items.length },
  items: state.items.map((title, index) => ({
    id: String(index),
    props: { title },
  })),
}));
```

```tsx
// src/routes/__root.tsx
import { Outlet } from "@tanstack/react-router";
import { useSlopUI } from "@slop-ai/tanstack-start";

export function RootLayout() {
  useSlopUI();
  return <Outlet />;
}
```

```tsx
// any route component
import { useSlop } from "@slop-ai/tanstack-start";

useSlop("filters", {
  type: "status",
  props: { active: true },
});
```

## Server helpers

- `createSlopMiddleware()` for auto-refreshing after TanStack Start server functions
- `sharedState()` for Vite dev-server singleton state
- `createWebSocketHandler()` and `slopVitePlugin()` from `@slop-ai/tanstack-start/server`

## Documentation

- API reference: https://docs.slopai.dev/api/tanstack-start
- TanStack Start guide: https://docs.slopai.dev/guides/tanstack-start
- Server provider docs: https://docs.slopai.dev/api/server
