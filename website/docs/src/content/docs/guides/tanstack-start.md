---
title: "TanStack Start"
description: How to use SLOP with TanStack Start to expose server and UI state to AI agents.
---

TanStack Start is a full-stack React meta-framework with SSR, server functions, and file-based routing. The `@slop-ai/tanstack-start` adapter is a **Layer 4** integration that wires everything together: the server runs a data provider (WebSocket), the browser runs a UI provider (postMessage), and AI consumers subscribe to both.

See the full working example in [`examples/tanstack-start/`](https://github.com/slop-ai/slop/tree/main/examples/tanstack-start).

## Installation

```bash
bun add @slop-ai/server @slop-ai/tanstack-start
```

## Server setup

### 1. State file (`src/server/state.ts`)

In development, Vite runs your server code in isolated module environments. A normal module-level variable can end up duplicated across those environments. `sharedState()` guarantees a single copy:

```ts
import { sharedState } from "@slop-ai/tanstack-start/server";

const state = sharedState("my-app", {
  items: [] as Item[],
  nextId: 1,
});

export function getItems(): Item[] {
  return state.items;
}

export function addItem(title: string) {
  state.items.push({ id: `id-${state.nextId++}`, title });
}
```

`sharedState(key, initialValue)` returns the same object reference no matter how many times Vite re-imports the module.

### 2. SLOP registration (`src/server/slop.ts`)

Create the SLOP server instance and register descriptor functions that produce the tree on demand:

```ts
import { createSlopServer } from "@slop-ai/tanstack-start/server";
import { getItems, addItem } from "./state";

export const slop = createSlopServer({
  id: "my-app",
  name: "My App",
});

slop.register("items", () => ({
  type: "collection",
  props: { total: getItems().length },
  actions: {
    create_item: {
      params: { title: "string" },
      handler: (params) => addItem(params.title as string),
    },
  },
  items: getItems().map((item) => ({
    id: item.id,
    props: { title: item.title },
  })),
}));
```

`createSlopServer()` returns a singleton -- safe across Vite module environments, just like `sharedState()`. Descriptor functions registered with `slop.register()` are called lazily when the tree is read.

### 3. Middleware (`src/server/middleware.ts`)

After any server function mutates data, the SLOP tree needs to refresh so connected AI consumers see the change immediately. The adapter provides `createSlopMiddleware` which creates a TanStack Start middleware that auto-refreshes by looking up the SlopServer instance by ID at runtime:

```ts
import { createSlopMiddleware } from "@slop-ai/tanstack-start";

export const slopMiddleware = createSlopMiddleware();
```

No arguments needed if your app has one `SlopServer` (the common case). The middleware resolves the instance at runtime from the shared singleton map — no server-only imports in the module graph, so it's safe to import from route files. For multi-instance apps, pass the ID: `createSlopMiddleware("my-app")`.

Attach the middleware to any server function that writes data:

```ts
import { slopMiddleware } from "../server/middleware";

const createItemFn = createServerFn({ method: "POST" })
  .middleware([slopMiddleware])
  .inputValidator((d: { title: string }) => d)
  .handler(async ({ data }) => {
    const { addItem } = await import("../server/state");
    addItem(data.title);
  });
```

## Vite config -- WebSocket plugin

The adapter provides a WebSocket handler that plugs into Vite's dev server. Add this plugin to your `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    // ... your other plugins
    {
      name: "slop-adapter",
      configureServer(server) {
        server.httpServer?.once("listening", async () => {
          const { slop } = (await server.ssrLoadModule(
            "./src/server/slop.ts"
          )) as any;
          const { createWebSocketHandler } = (await server.ssrLoadModule(
            "@slop-ai/tanstack-start/server"
          )) as any;
          const ws = await import("ws");

          const handler = createWebSocketHandler({ resolve: () => slop });
          const wss = new ws.WebSocketServer({ noServer: true });

          server.httpServer!.on("upgrade", (req, socket, head) => {
            const url = new URL(req.url!, `http://${req.headers.host}`);
            if (url.pathname === "/slop") {
              wss.handleUpgrade(req, socket, head, (wsConn) => {
                const peer = {
                  send: (data: string) => {
                    if (wsConn.readyState === 1) wsConn.send(data);
                  },
                  close: () => wsConn.close(),
                  __slop: null as any,
                };
                handler.open(peer);
                wsConn.on("message", (data: any) => {
                  handler.message(peer, {
                    text: () => data.toString(),
                    toString: () => data.toString(),
                  });
                });
                wsConn.on("close", () => handler.close(peer));
              });
            }
          });

          console.log("[slop] WebSocket adapter ready at /slop");
        });
      },
    },
  ],
});
```

The plugin uses `server.ssrLoadModule` to import the SLOP instance from within Vite's SSR environment -- the same environment your server functions run in. This ensures the plugin sees the exact same `slop` singleton.

## Route components

### `useSlopUI()` — in the root layout

Call `useSlopUI()` once in your root layout (`__root.tsx`). It:

- Creates a browser-side SLOP provider (postMessage) for UI state
- Registers the current route (path, params, available routes) automatically
- Provides `navigate` and `back` actions so AI can navigate the user
- Registers a `refresh` affordance the consumer invokes for data invalidation
- Auto-updates on every navigation

```tsx
// src/routes/__root.tsx
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useSlopUI } from "@slop-ai/tanstack-start";

export const Route = createRootRoute({
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootLayout() {
  useSlopUI();
  return <Outlet />;
}
```

Since it's in the root layout, every page gets SLOP connectivity for free. Individual pages don't need to call `useSlopUI()`.

### `useSlop(path, descriptor)` — in page components

Register page-specific UI state on the browser's SLOP provider. Each call creates a node that AI agents can read and interact with:

```tsx
// src/routes/index.tsx
import { useSlop } from "@slop-ai/tanstack-start";

function ProjectsPage() {
  const { projects } = Route.useLoaderData();
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [newName, setNewName] = useState("");

  // Expose the filter UI state
  useSlop("filters", {
    type: "status",
    props: { status: filter },
    actions: {
      set_filter: {
        params: { status: "string" },
        handler: (params: any) => setFilter(params.status),
      },
    },
  });

  // Expose the create form UI state
  useSlop("create_form", {
    type: "view",
    props: { name: newName },
    actions: {
      type: {
        params: { value: "string" },
        handler: (params: any) => setNewName(params.value),
      },
      submit: async () => {
        if (newName.trim()) {
          await createProjectFn({ data: { name: newName } });
          setNewName("");
        }
      },
      clear: () => setNewName(""),
    },
  });

  // ... render
}
```

When the user navigates to a different page, the old `useSlop` registrations unregister automatically and the new page's registrations take their place — the browser provider's tree updates to reflect the current page.

## Discovery

Add a `<meta name="slop">` tag so AI agents can find the server's WebSocket endpoint. The browser-side UI provider's meta tag (`postmessage`) is injected automatically by `useSlopUI()`.

```tsx
// src/routes/__root.tsx
export const Route = createRootRoute({
  head: () => ({
    meta: [
      // ... other meta tags
      { name: "slop", content: "ws://localhost:3000/slop" },
      // Note: useSlopUI() auto-injects a second meta tag for the postMessage UI provider
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,  // useSlopUI() lives here
});
```

AI consumers discover both providers: the WebSocket endpoint (data) from the meta tag, and the postMessage provider (UI) from the auto-injected tag.

## What the AI sees

The consumer (extension or desktop app) subscribes to both providers and merges them into one tree:

```
[root] merged                            # merged by the consumer
  [data] My App                          # from server provider (WebSocket)
    projects/
      props: { total: 3, active: 2 }
      actions: [create_project]
      p1/
        props: { name: "SLOP Protocol", status: "active", taskCount: 3, done: 1 }
        actions: [archive, rename, add_task]
        tasks/
          t1/ props: { title: "Write spec", done: true }  actions: [toggle, delete]
          t2/ ...
      p2/ ...
  [ui] UI                                # from browser provider (postMessage)
    route/                               # auto-registered by useSlopUI()
      props: { path: "/", availableRoutes: ["/", "/about", "/projects/$id"] }
      actions: [navigate, back]
    __adapter/                           # auto-registered refresh affordance
      actions: [refresh]
    filters/                             # registered by useSlop("filters", ...)
      props: { status: "all" }
      actions: [set_filter]
    create_form/                         # registered by useSlop("create_form", ...)
      props: { name: "" }
      actions: [type, submit, clear]
```

The AI can navigate with `navigate`, invoke server actions like `rename`, interact with UI state like `set_filter`, or trigger a data re-fetch with `refresh`.

## How it works

The architecture has three participants: the **server** (data provider), the **browser** (UI provider), and the **consumer** (extension/desktop app). Both providers speak standard SLOP — no custom protocol extensions.

**Server is the data provider.** Descriptor functions registered with `slop.register()` produce the data tree. Connected via WebSocket.

**Browser runs a UI provider.** When `useSlopUI()` mounts, the browser's `@slop-ai/client` instance exposes UI state (route, filters, compose form) via postMessage. The adapter also registers a `refresh` affordance that calls `router.invalidate()` when invoked.

**AI consumers subscribe to both providers.** The consumer (extension or desktop app) connects to the server's WebSocket for data state and to the browser's postMessage for UI state. It merges them into one tree and routes invokes to the correct provider.

### Data flow

1. **Data actions:** An AI consumer invokes a data action (e.g. `create_project`). The consumer routes this to the server provider. The server executes the handler, refreshes the tree, and the consumer sees the updated data via patches.

2. **Data invalidation:** After a data action completes, the consumer invokes `refresh` on the browser's UI provider. The adapter's refresh handler calls `router.invalidate()`, triggering TanStack Router to re-run loaders and re-render with fresh data.

3. **UI actions:** An AI consumer invokes a UI action (e.g. `set_filter`). The consumer routes this to the browser's UI provider. The browser executes the handler locally (a React state setter), which updates the component and the UI provider's tree.

## Next steps

- Browse the full example at [`examples/tanstack-start/`](https://github.com/slop-ai/slop/tree/main/examples/tanstack-start)
- See the [API Reference](/reference/core/) for the full node descriptor format
- Read the [React guide](/guides/react/) for client-only SLOP usage without a meta-framework
