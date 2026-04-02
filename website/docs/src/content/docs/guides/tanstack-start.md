---
title: "TanStack Start"
description: Use SLOP in TanStack Start with server state plus mounted UI state
---

`@slop-ai/tanstack-start` is the full-stack adapter for TanStack Start. The server owns the public provider, and the browser UI provider connects back so the server can mount it under `ui`.

See the working example in [examples/full-stack/tanstack-start](https://github.com/devteapot/slop/tree/main/examples/full-stack/tanstack-start).

## Install

```bash
bun add @slop-ai/server @slop-ai/tanstack-start
```

## 1. Create shared server state

```ts
// src/server/slop.ts
import { createSlopServer, sharedState } from "@slop-ai/tanstack-start/server";

const state = sharedState("my-app", {
  items: [] as Array<{ id: string; title: string }>,
  nextId: 1,
});

export const slop = createSlopServer({
  id: "my-app",
  name: "My App",
});

slop.register("items", () => ({
  type: "collection",
  props: { count: state.items.length },
  items: state.items.map((item) => ({
    id: item.id,
    props: { title: item.title },
  })),
}));
```

`sharedState()` keeps development-time state stable across Vite module reload boundaries.

## 2. Auto-refresh after server mutations

```ts
// src/server/middleware.ts
import { createSlopMiddleware } from "@slop-ai/tanstack-start";

export const slopMiddleware = createSlopMiddleware();
```

Attach that middleware to server functions that mutate data.

## 3. Attach the WebSocket endpoint in Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { slopVitePlugin } from "@slop-ai/tanstack-start/server";
import { slop } from "./src/server/slop";

export default defineConfig({
  plugins: [
    tanstackStart(),
    slopVitePlugin({ resolve: () => slop }),
  ],
});
```

## 4. Mount UI state from the browser

```tsx
// src/routes/__root.tsx
import { Outlet } from "@tanstack/react-router";
import { useSlopUI } from "@slop-ai/tanstack-start";

export function RootLayout() {
  useSlopUI();
  return <Outlet />;
}
```

Then expose per-route UI state:

```tsx
import { useSlop } from "@slop-ai/tanstack-start";

useSlop("filters", {
  type: "status",
  props: { status: "all" },
});
```

## What consumers see

Consumers connect to the server provider once. That tree includes both:

- server-owned data such as `items`
- browser-owned UI state under `ui`

## Next Steps

- [TanStack Start package API](/api/tanstack-start)
- [Server provider API](/api/server)
- [React guide](/guides/react)
