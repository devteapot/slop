---
title: "TanStack Start"
description: How to use SLOP with TanStack Start to expose server and UI state to AI agents.
---

TanStack Start is a full-stack React meta-framework with SSR, server functions, and file-based routing. The `@slop-ai/tanstack-start` adapter is a **Layer 4** integration that wires everything together: the server owns the SLOP tree, the browser reports UI state over a bidirectional WebSocket, and AI consumers connect to the same socket.

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

### `useSlopUI()`

Call `useSlopUI()` once per page component. It:

- Opens a WebSocket connection to the SLOP server
- Registers the current route so AI consumers can see which page the user is on
- Automatically updates when the user navigates

### `useSlop(path, descriptor)`

Register client-side UI state under the `ui/` prefix of the SLOP tree. Each call creates a node that AI agents can read and interact with:

```tsx
import { useSlopUI, useSlop } from "@slop-ai/tanstack-start";

function ProjectsPage() {
  const { projects } = Route.useLoaderData();
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [newName, setNewName] = useState("");

  // Connect this page to SLOP
  useSlopUI();

  // Expose the filter UI state
  useSlop("filters", {
    type: "status",
    props: { status: filter },
    actions: {
      ui_set_filter: {
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
      ui_type: {
        params: { value: "string" },
        handler: (params: any) => setNewName(params.value),
      },
      ui_submit: async () => {
        if (newName.trim()) {
          await createProjectFn({ data: { name: newName } });
          setNewName("");
        }
      },
      ui_clear: () => setNewName(""),
    },
  });

  // ... render
}
```

Both hooks are imported from `@slop-ai/tanstack-start` (the client entry point -- not `/server`).

## Discovery

Add a `<meta name="slop">` tag so AI agents can find the WebSocket endpoint. In TanStack Start, this goes in the `head()` route option of your root route (`src/routes/__root.tsx`):

```tsx
export const Route = createRootRoute({
  head: () => ({
    meta: [
      // ... other meta tags
      {
        name: "slop",
        content: "ws://localhost:3000/slop",
      },
    ],
  }),
  shellComponent: RootDocument,
});
```

An AI agent visiting the page can read this tag to know where to connect.

## What the AI sees

When an AI consumer connects to the WebSocket, it sees a merged tree of server-side data and client-side UI state:

```
/
  projects/                          # server data (from slop.register)
    props: { total: 3, active: 2 }
    actions: [create_project]
    p1/
      props: { name: "SLOP Protocol", status: "active", taskCount: 3, done: 1 }
      actions: [archive, rename, add_task]
      tasks/
        t1/
          props: { title: "Write spec", done: true }
          actions: [toggle, delete]
        t2/ ...
    p2/ ...
  ui/                                # client UI state (from useSlop)
    route: /
    filters/
      props: { status: "all" }
      actions: [ui_set_filter]
    create_form/
      props: { name: "" }
      actions: [ui_type, ui_submit, ui_clear]
```

Server data and UI state live side by side. An AI can read `projects/p1/props` to understand the data, invoke `projects/p1/actions/rename` to mutate server state, or invoke `ui/filters/actions/ui_set_filter` to change what the user sees on screen.

## How it works

The architecture has three participants: the **server**, the **browser**, and one or more **AI consumers**. All three communicate through the SLOP server over WebSocket.

**Server owns the tree.** Descriptor functions registered with `slop.register()` produce the data portion of the tree. The server is the source of truth.

**Browser reports UI state.** When `useSlopUI()` mounts, the browser opens a WebSocket to the server and pushes its current UI state (from `useSlop` calls). The server merges this into the tree under `ui/`.

**AI consumers connect to the same WebSocket.** They receive the full merged tree and can invoke actions on either the data or UI side.

### Data flow

1. **Data invalidation:** A server function mutates state. The `slopMiddleware` calls `slop.refresh()`, which re-evaluates descriptor functions and computes a diff. Connected clients receive a `data_changed` signal. The browser handles this by calling `router.invalidate()`, triggering TanStack Router to re-run loaders and re-render.

2. **UI actions:** An AI consumer invokes a UI action (e.g. `ui_set_filter`). The server forwards this to the browser over WebSocket. The browser executes the handler locally (a React state setter), which updates the component and reports the new UI state back to the server.

3. **Data actions:** An AI consumer invokes a data action (e.g. `create_project`). The server executes the handler directly, then refreshes the tree. Both the browser and AI consumer see the updated state.

## Next steps

- Browse the full example at [`examples/tanstack-start/`](https://github.com/slop-ai/slop/tree/main/examples/tanstack-start)
- See the [API Reference](/reference/core/) for the full node descriptor format
- Read the [React guide](/guides/react/) for client-only SLOP usage without a meta-framework
