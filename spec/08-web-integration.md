# 08 — Web Integration

The web is the richest surface for SLOP. This document covers how web apps expose state to AI consumers, from native SLOP integration to browser extension adapters for unmodified apps.

## Three tiers of web integration

Web apps can participate in SLOP at three levels, depending on how much cooperation the app provides:

```
Tier 1: SLOP-native       App implements SLOP directly. Richest state, best affordances.
Tier 2: Framework adapter  Extension hooks into React/Vue/Svelte state. Good state, generic affordances.
Tier 3: Accessibility      Extension reads the browser's accessibility tree. Basic state, basic affordances.
```

Higher tiers require app involvement but produce better results. Lower tiers work without any app changes but lose semantic richness.

| Tier | App cooperation | State quality | Affordance quality | Effort |
|---|---|---|---|---|
| Native | App implements SLOP | Semantic, precise | Domain-specific | App developer |
| Framework | None (extension hooks into framework internals) | Structured but generic | Click/type/navigate | Extension developer |
| Accessibility | None (extension reads browser AX tree) | UI-level, lossy | Click/type | Extension developer |

## Tier 1: SLOP-native web apps

The app includes a SLOP provider. This is the ideal case — the app decides what state to expose and what affordances to offer, producing the richest possible representation.

### Where the provider runs

There are two architectures, depending on whether the app has a server:

**Server-side provider (server-backed apps)**

The provider runs on the server. The server already owns the canonical state. AI consumers connect over WebSocket.

```
Browser ←—app WS—→ Server ←—SLOP WS—→ AI consumer
                   (provider)
                      ↑
                   Unix sock → local AI agents
```

The server exposes a SLOP WebSocket endpoint at `/slop`. The same provider instance can serve both WebSocket consumers (remote) and Unix socket consumers (local agents) simultaneously.

**In-browser provider (client-only SPAs)**

For apps with no server — local-first apps, offline-capable SPAs, browser-based tools — the provider runs inside the page. AI consumers connect via `postMessage`.

```
┌─ Browser ──────────────────────────────────────┐
│                                                 │
│  Page context              Extension context    │
│  ┌─────────────┐           ┌───────────────┐   │
│  │ App state   │           │ SLOP consumer  │   │
│  │ SLOP provider│◄─postMessage──►            │   │
│  └─────────────┘           └───────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

The app includes a client-side SLOP provider library. The provider implements the same protocol — `hello`, `subscribe`, `snapshot`, `patch`, `invoke` — but sends messages through `postMessage` instead of a network socket.

From the AI consumer's perspective, nothing changes. It connects, subscribes, receives state trees and patches, and invokes affordances — regardless of whether the provider is on a server or in the browser.

### Discovery

SLOP-native apps declare themselves via an HTML meta tag and/or a well-known URL. See [03 — Transport & Discovery](./03-transport.md#web-discovery).

```html
<!-- Server-backed: WebSocket endpoint -->
<meta name="slop" content="ws://localhost:3737/slop">

<!-- Client-only SPA: postMessage -->
<meta name="slop" content="postmessage">
```

### Client-side developer integration (SPAs)

Integrating SLOP into a client-side SPA involves two things:

1. **Tree building** — a function that maps app state to a SLOP tree. This is inherently app-specific: the developer decides what state to expose, how to structure it, and what affordances to offer. The SLOP tree is a *curated projection*, not a raw dump — just as a REST API doesn't expose the database.

2. **Affordance handlers** — callbacks that execute when the AI invokes an action. These map SLOP invocations back to the app's own state mutations.

The integration should be **non-invasive** — it should not require changes to the app's UI layer. The SLOP tree is derived from state, not from the UI. The two are separate concerns.

#### Package architecture

SLOP's library follows the TanStack Query model: a shared engine with thin transport shells and framework adapters. No contexts, no providers — just objects you create and import.

The library is organized into layers. Each layer is framework-agnostic — it handles one concern and delegates the rest.

```
Layer 0: Protocol (spec/)               — Messages, state trees, affordances
Layer 1: Engine (@slop-ai/core)          — Tree assembly, diffing, descriptor format, types
Layer 2: Transport (@slop-ai/client,     — postMessage, WebSocket, Unix socket, stdio
         @slop-ai/server)
Layer 3: SPA adapters (@slop-ai/react,   — useSlop() hooks for component lifecycle
         vue, solid, angular)
Layer 4: Meta-framework adapters         — Full integration for Next.js, Nuxt, SvelteKit
         (@slop-ai/next, nuxt, sveltekit)  (server setup, UI sync, state composition)
```

```
@slop-ai/core           — Shared engine: tree assembly, diffing, descriptor format, types, helpers
@slop-ai/client         — Browser provider: createSlop() + postMessage transport
@slop-ai/server         — Server/native provider: createSlopServer() + WebSocket, Unix socket, stdio transports
@slop-ai/react          — useSlop() hook (~15 lines)
@slop-ai/vue            — useSlop() composable (~10 lines)
@slop-ai/solid          — useSlop() primitive (~10 lines)
@slop-ai/angular        — useSlop() with signals (~15 lines)
@slop-ai/next           — Next.js integration (server setup + UI sync + state composition)
@slop-ai/nuxt           — Nuxt module (Nitro WebSocket + auto-sync + composables)
@slop-ai/sveltekit      — SvelteKit integration (Vite plugin + load invalidation)
(vanilla JS)            — use @slop-ai/client directly, no adapter needed
```

`@slop-ai/core` is the engine — it owns tree assembly, diffing, descriptor-to-wire-format translation, typed schema, and helpers (`action`, `pick`, `omit`, `asyncAction`). It has no transport. `@slop-ai/client` and `@slop-ai/server` are thin shells that wrap the engine with a transport layer. Meta-framework adapters sit on top and handle the full developer experience for a specific framework.

```
@slop-ai/next ──────────┐
@slop-ai/nuxt ──────────┼──→ @slop-ai/server + @slop-ai/client
@slop-ai/sveltekit ─────┘         ↑
                            @slop-ai/core (shared engine)
                                   ↑
@slop-ai/react ──┐                 │
@slop-ai/vue  ──┤                 │
@slop-ai/solid ──┼─────────────────┘
@slop-ai/angular─┘
```

| | `@slop-ai/core` | `@slop-ai/client` | `@slop-ai/server` |
|---|---|---|---|
| Runs in | Any JS environment | Browser | Node, Bun, Deno |
| Transport | None | postMessage | WebSocket, Unix socket, stdio |
| Descriptor format | Defines it | Uses it | Uses it |
| Tree assembly & diffing | Owns it | Delegates to core | Delegates to core |
| Reactivity | None — pure logic | Framework re-renders | Descriptor functions + `refresh()` |
| Discovery | None | `<meta>` tag injection | `/.well-known/slop`, `~/.slop/providers/` |

| App type | Install | Layer |
|---|---|---|
| React/Vue/Solid SPA | `@slop-ai/client` + `@slop-ai/react` (or vue, solid, angular) | 2 + 3 |
| Vanilla JS SPA | `@slop-ai/client` | 2 |
| Next.js fullstack | `@slop-ai/next` (wraps server + client) | 4 |
| Nuxt fullstack | `@slop-ai/nuxt` (Nuxt module) | 4 |
| SvelteKit fullstack | `@slop-ai/sveltekit` (wraps server + client) | 4 |
| Express / Fastify / Hono | `@slop-ai/server` | 2 |
| Electron / Tauri native app | `@slop-ai/server` (Unix socket transport) | 2 |
| CLI tool | `@slop-ai/server` (stdio transport) | 2 |

Framework adapters depend on `@slop-ai/core` only — they call `register()`/`unregister()` on the engine, which is transport-agnostic. No state-library-specific adapters are needed — the pattern works with useState, Zustand, Redux, MobX, Jotai, Pinia, or plain variables.

#### The core client

The app creates a single `SlopClient` instance. It's a plain JavaScript object — no framework dependency, no context, no provider.

```ts
// slop.ts — create once, import anywhere in your app
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "my-app",
  name: "My App",
  // automatically uses postMessage transport, injects <meta name="slop"> tag
});
```

The client has three methods:

```ts
slop.register(path, descriptor)   // add or update a node in the tree
slop.unregister(path)             // remove a node from the tree
slop.scope(path, descriptor?)     // create a scoped client for a subtree
```

That's the entire public API. Internally, the client:
1. Collects all registered node descriptors
2. Assembles them into a hierarchical SLOP state tree (paths determine nesting)
3. Diffs against the previous tree on each change
4. Pushes patches via the configured transport (postMessage or WebSocket)
5. Routes incoming `invoke` messages to the handler declared in the descriptor
6. Injects `<meta name="slop">` into the page automatically

#### Typed schema

The `createSlop` function accepts an optional `schema` that defines the tree's structural skeleton. When provided, all paths are type-checked at compile time — invalid paths are TypeScript errors, and valid paths get full autocomplete.

```ts
// slop.ts
import { createSlop } from "@slop-ai/core";

const schema = {
  inbox: {
    messages: "collection",
    compose: "form",
    unread: "status",
  },
  settings: {
    account: "group",
    notifications: "group",
    privacy: "group",
  },
} as const;

export const slop = createSlop({ id: "mail-app", name: "Mail", schema });
```

Now `register()` only accepts paths that exist in the schema:

```ts
slop.register("inbox", { ... });              // ✓ valid path, autocomplete works
slop.register("inbox/messages", { ... });     // ✓
slop.register("settings/account", { ... });   // ✓

slop.register("inbox/nonexistent", { ... });  // ✗ compile error
slop.register("foo", { ... });                // ✗ compile error
```

The schema declares **structure** (what paths exist), not **data** (what values they hold). Dynamic children — items in a collection — are not in the schema. They're declared in the descriptor's `items` array:

```ts
slop.register("inbox/messages", {
  type: "collection",
  items: messages.map(m => ({    // ← dynamic items, not in schema
    id: m.id,
    props: { from: m.from, subject: m.subject },
    actions: { archive: () => archiveMessage(m.id) },
  })),
});
```

The schema also constrains the descriptor type. If the schema declares `messages: "collection"`, the descriptor for that path must have `type: "collection"` and can use `items`. A node declared as `"status"` can't have `items`.

**How it works internally** — TypeScript's template literal types recursively extract all valid paths from the schema:

```ts
type ExtractPaths<T, P extends string = ""> = {
  [K in keyof T & string]:
    | `${P}${K}`
    | (T[K] extends string ? never : ExtractPaths<T[K], `${P}${K}/`>)
}[keyof T & string];

// From the schema above, produces:
// "inbox" | "inbox/messages" | "inbox/compose" | "inbox/unread"
// | "settings" | "settings/account" | "settings/notifications" | "settings/privacy"
```

Scoped clients are also type-narrowed:

```ts
const inbox = slop.scope("inbox");          // type: SlopClient<InboxSubSchema>
inbox.register("messages", { ... });        // ✓ valid under inbox
inbox.register("nonexistent", { ... });     // ✗ compile error
```

The schema is optional — `createSlop()` without a schema works the same way, just without compile-time path checking. This lets teams adopt typing incrementally.

#### Node descriptors

Developers describe nodes using a **developer-friendly format**, not raw SLOP protocol structures. The library translates internally.

```js
{
  type: "collection",                           // SLOP node type
  props: { count: 42 },                         // properties (not "properties")
  items: [                                      // children of type "item" (not "children")
    {
      id: "note-1",
      props: { title: "Hello", pinned: true },
      actions: {                                // affordances (not "affordances")
        toggle: () => togglePin("note-1"),      // simple action — just a callback
        delete: {                               // action with options
          handler: () => remove("note-1"),
          dangerous: true,
        },
        edit: {                                 // action with typed parameters
          params: { title: "string", content: "string" },
          handler: ({ title, content }) => update("note-1", title, content),
        },
      },
    },
  ],
  actions: {                                    // collection-level actions
    create: {
      params: { title: "string" },
      handler: ({ title }) => addNote(title),
    },
  },
}
```

Key naming choices:
- `props` not `properties` — shorter, matches React convention
- `actions` not `affordances` — developers think in actions, not affordances
- `items` not `children` — semantic shorthand for `children` with `type: "item"`
- Handlers are callbacks, not serialized function names

The library expands this to proper SLOP nodes internally. The developer never writes `{ id: "x", type: "item", properties: {...}, affordances: [...], meta: {...} }` by hand.

#### Hierarchical registration

Nodes are registered from different components using **path-based IDs** that encode their position in the tree. The client assembles the hierarchy automatically.

```tsx
// InboxView.tsx — registers the view node
import { slop } from "./slop";
import { useSlop } from "@slop-ai/react";

function InboxView() {
  useSlop(slop, "inbox", { type: "view", props: { label: "Inbox" } });

  return (
    <div>
      <MessageList />
      <UnreadBadge />
    </div>
  );
}
```

```tsx
// MessageList.tsx — registers under inbox/messages
function MessageList() {
  const [messages] = useMessages();

  useSlop(slop, "inbox/messages", {
    type: "collection",
    props: { count: messages.length },
    items: messages.map(m => ({
      id: m.id,
      props: { from: m.from, subject: m.subject, unread: m.unread },
      actions: {
        open: () => openMessage(m.id),
        archive: () => archiveMessage(m.id),
        delete: { handler: () => deleteMessage(m.id), dangerous: true },
      },
    })),
  });

  return <div>{messages.map(m => <MessageRow key={m.id} message={m} />)}</div>;
}
```

```tsx
// UnreadBadge.tsx — registers under inbox/unread
function UnreadBadge() {
  const count = useUnreadCount();

  useSlop(slop, "inbox/unread", {
    type: "status",
    props: { count },
  });

  return <span className="badge">{count}</span>;
}
```

The client parses the paths and assembles the tree:

```
root
├── inbox (view) ← from InboxView
│   ├── messages (collection) ← from MessageList
│   │   ├── msg-1 (item)
│   │   └── msg-2 (item)
│   └── unread (status) ← from UnreadBadge
```

Each component only knows about its own path. When a component unmounts, its nodes (and their children) disappear from the tree automatically.

#### Scoped clients

For reusable components that shouldn't hardcode their position in the tree, use `scope()`:

```tsx
function InboxView() {
  const inbox = slop.scope("inbox", { type: "view" });

  return (
    <div>
      {/* MessageList doesn't know it's under "inbox" */}
      <MessageList slop={inbox} />
      <UnreadBadge slop={inbox} />
    </div>
  );
}

function MessageList({ slop: scope }) {
  const [messages] = useMessages();

  // Registers as "inbox/messages" internally — but this component doesn't know that
  useSlop(scope, "messages", {
    type: "collection",
    items: messages.map(m => ({
      id: m.id,
      props: { from: m.from, subject: m.subject },
      actions: { archive: () => archiveMessage(m.id) },
    })),
  });

  return <div>{messages.map(...)}</div>;
}

// MessageList is reusable — mount it under inbox, archive, or search results:
<MessageList slop={slop.scope("inbox")} />
<MessageList slop={slop.scope("search-results")} />
```

#### Inline children

For components that own a full subtree, declare children inline in the descriptor:

```tsx
useSlop(slop, "settings", {
  type: "view",
  children: {
    account: {
      type: "group",
      props: { email: user.email, plan: user.plan },
      actions: {
        change_email: {
          params: { email: "string" },
          handler: ({ email }) => updateEmail(email),
        },
      },
    },
    notifications: {
      type: "group",
      props: { enabled: prefs.notifications },
      actions: {
        toggle: () => toggleNotifications(),
      },
    },
  },
});
```

All three patterns — path IDs, scoped clients, inline children — produce the same tree. Mix them based on component structure:

| Pattern | Use when |
|---|---|
| Path IDs (`"inbox/messages"`) | Component knows where it sits. Simple, explicit. |
| Scoped client (`slop.scope("inbox")`) | Component is reusable across different tree positions. |
| Inline children (`children: {...}`) | One component owns the full subtree. |

#### Framework adapters

Each adapter is a thin wrapper that handles mount/update/unmount lifecycle. The logic is identical; only the framework API differs.

**React** (`@slop-ai/react`):

```tsx
import { useEffect, useRef } from "react";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

export function useSlop(client: SlopClient, id: string, descriptor: NodeDescriptor) {
  client.register(id, descriptor);  // register/update on every render

  useEffect(() => {
    return () => client.unregister(id);  // unregister on unmount
  }, [client, id]);
}
```

**Vue** (`@slop-ai/vue`):

```js
import { watchEffect, onUnmounted } from "vue";

export function useSlop(client, id, descriptorFn) {
  watchEffect(() => client.register(id, descriptorFn()));
  onUnmounted(() => client.unregister(id));
}
```

**Svelte** (`@slop-ai/svelte`):

```js
import { onDestroy } from "svelte";

export function useSlop(client, id, descriptorFn) {
  $effect(() => client.register(id, descriptorFn()));
  onDestroy(() => client.unregister(id));
}
```

**Vanilla JS** (no adapter needed):

```js
import { slop } from "./slop";

slop.register("notes", { ... });
store.subscribe(() => slop.register("notes", { ... }));  // register doubles as update
```

#### What the client handles

```
Component A: slop.register("inbox", { type: "view" })
Component B: slop.register("inbox/messages", { type: "collection", items: [...] })
Component C: slop.register("inbox/unread", { type: "status", props: { count: 5 } })
                    ↓
         @slop-ai/core assembles hierarchical tree
                    ↓
         @slop-ai/client pushes patches via postMessage
                    ↓
         Receives invoke → routes to handler in descriptor
```

### Server-side developer integration

Server-backed apps (Next.js, Nuxt, SvelteKit, Express) and native apps (Electron, Tauri, CLI tools) use `@slop-ai/server`. The server owns the canonical state and serves it over WebSocket, Unix socket, or stdio.

#### The server client

```ts
// lib/slop.ts — create once, import anywhere in your server
import { createSlopServer } from "@slop-ai/server";

export const slop = createSlopServer({
  id: "my-app",
  name: "My App",
});
```

The server client has the same core methods as the browser client, plus `refresh()`:

```ts
slop.register(path, descriptorFn)   // add or update a node (accepts a function)
slop.unregister(path)               // remove a node
slop.scope(path, descriptorFn?)     // create a scoped server client
slop.refresh()                      // re-evaluate all descriptors, diff, broadcast
slop.stop()                         // shutdown: close transports, unregister discovery
```

#### Descriptor functions

On the client, framework reactivity (React renders, Vue `watchEffect`) automatically re-calls `register()` when state changes. On the server, there is no reactivity system. The descriptor function solves this — `register()` accepts a function that returns a descriptor, and the server re-evaluates it at well-defined moments:

1. **On initial registration** — evaluates immediately to build the initial tree segment.
2. **After every successful invoke** — the server automatically calls `refresh()` after an action handler completes, because invocations almost always mutate state.
3. **On explicit `refresh()`** — for mutations that happen outside of SLOP (REST API calls, background jobs, database triggers).

```ts
import { createSlopServer } from "@slop-ai/server";
import { getTodos, addTodo, toggleTodo, deleteTodo } from "./state";

const slop = createSlopServer({ id: "nextjs-todos", name: "Next.js Todos" });

slop.register("todos", () => ({
  type: "collection",
  props: { count: getTodos().length, done: getTodos().filter(t => t.done).length },
  actions: {
    add: {
      params: { title: "string" },
      handler: ({ title }) => addTodo(title),
      // After handler completes, server auto-refreshes — no manual setTree() needed
    },
  },
  items: getTodos().map(t => ({
    id: t.id,
    props: { title: t.title, done: t.done },
    actions: {
      toggle: () => toggleTodo(t.id),
      delete: { handler: () => deleteTodo(t.id), dangerous: true },
    },
  })),
}));
```

For mutations outside of SLOP (e.g., from the app's own REST API):

```ts
// REST endpoint — mutation happens outside SLOP
app.post("/api/todos", (req, res) => {
  addTodo(req.body.title);
  slop.refresh();  // re-evaluate all descriptor functions, diff, broadcast patches
  res.json({ ok: true });
});
```

The developer never constructs wire-format trees (`properties`, `affordances`, `children`) or manages subscriptions by hand. The same descriptor format — `props`, `actions`, `items` — works identically on client and server.

#### Transport adapters

The server SDK provides adapters for attaching to existing servers. Each adapter handles connection lifecycle, the SLOP protocol handshake, and optionally discovery.

| Adapter | Import | Use case |
|---|---|---|
| `attachSlop(slop, httpServer)` | `@slop-ai/server/node` | Node HTTP, Express, Fastify, Hono |
| `bunHandler(slop)` | `@slop-ai/server/bun` | Bun.serve |
| `listenUnix(slop, path?)` | `@slop-ai/server/unix` | Electron, Tauri, daemons |
| `listenStdio(slop)` | `@slop-ai/server/stdio` | CLI tools, subprocess providers |

**Node.js HTTP / Express:**

```ts
import { createServer } from "node:http";
import { attachSlop } from "@slop-ai/server/node";
import { slop } from "./lib/slop";

const server = createServer(app);
attachSlop(slop, server, { path: "/slop" });  // handles WS upgrade + /.well-known/slop
server.listen(3000);
```

**Unix socket (native apps):**

```ts
import { listenUnix } from "@slop-ai/server/unix";

listenUnix(slop, "/tmp/slop/my-app.sock", { register: true });
// register: true → writes ~/.slop/providers/my-app.json, cleans up on shutdown
```

**Multiple transports simultaneously:**

```ts
attachSlop(slop, httpServer);     // remote consumers via WebSocket
listenUnix(slop);                 // local agents via Unix socket
```

All transports share the same provider instance — one state tree, multiple access paths. An action invoked via WebSocket updates the tree for Unix socket subscribers too.

#### Meta-framework helpers

One-liner integrations for popular frameworks:

**Nuxt (Nitro WebSocket handler):**

```ts
// server/routes/slop.ts
import { nitroHandler } from "@slop-ai/server/nitro";
import { slop } from "../utils/slop";

export default nitroHandler(slop);
```

**SvelteKit (Vite plugin for dev + adapter-node for prod):**

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { slopPlugin } from "@slop-ai/server/vite";
import { slop } from "./src/lib/server/slop";

export default { plugins: [sveltekit(), slopPlugin(slop)] };
```

**Next.js (custom server with attachSlop):**

```ts
// server.ts
import next from "next";
import { createServer } from "node:http";
import { attachSlop } from "@slop-ai/server/node";
import { slop } from "./lib/slop";

const app = next({ dev: true });
await app.prepare();
const server = createServer((req, res) => app.getRequestHandler()(req, res));
attachSlop(slop, server);
server.listen(3000);
```

#### Native apps

Electron, Tauri, and CLI tools are server-side providers — they run as processes and serve the SLOP protocol over sockets. They use `@slop-ai/server` with the appropriate transport:

```ts
// Electron main process
import { createSlopServer } from "@slop-ai/server";
import { listenUnix } from "@slop-ai/server/unix";

const slop = createSlopServer({ id: "clipboard-manager", name: "Clipboard Manager" });

slop.register("entries", () => ({
  type: "collection",
  props: { count: getEntries().length },
  items: getEntries().map(e => ({
    id: e.id,
    props: { preview: e.preview, favorite: e.favorite },
    actions: {
      copy: () => copyToClipboard(e.id),
      favorite: () => toggleFavorite(e.id),
      delete: { handler: () => deleteEntry(e.id), dangerous: true },
    },
  })),
}));

listenUnix(slop, "/tmp/slop/clipboard.sock", { register: true });
```

The desktop app or CLI agent discovers this provider via `~/.slop/providers/clipboard-manager.json` and connects over Unix socket — no browser extension needed.

#### Discovery

Server transports handle discovery automatically:

- **`attachSlop()`** auto-serves `GET /.well-known/slop` as a JSON endpoint (returning the provider descriptor). Disable with `{ discovery: false }`.
- **`listenUnix()`** auto-writes `~/.slop/providers/{id}.json` when `register: true` is set, and deletes it on shutdown.
- **`listenStdio()`** sends `hello` as the first message per the SLOP protocol — no separate discovery needed.

#### Typed schema and scoped clients

The server client accepts the same `schema` option as the browser client:

```ts
const slop = createSlopServer({
  id: "my-app",
  name: "My App",
  schema: { todos: "collection", settings: { theme: "status" } } as const,
});

slop.register("todos", () => ({ ... }));           // ✓ valid
slop.register("settings/theme", () => ({ ... }));  // ✓ valid
slop.register("nonexistent", () => ({ ... }));     // ✗ compile error
```

Scoped clients work the same way:

```ts
const api = slop.scope("api");
api.register("users", () => ({ ... }));     // registers at "api/users"
api.register("posts", () => ({ ... }));     // registers at "api/posts"
```

#### What the server handles

```
slop.register("todos", () => ({ type: "collection", ... }))
slop.register("settings", () => ({ type: "view", ... }))
                    ↓
         @slop-ai/core evaluates descriptor functions, assembles tree
                    ↓
         Diffs against previous tree (same engine as client)
                    ↓
         @slop-ai/server pushes patches via WebSocket / Unix socket / stdio
                    ↓
         Receives invoke → routes to handler in descriptor
                    ↓
         Auto-refreshes: re-evaluates all descriptor functions, diffs, broadcasts
```

### Meta-framework adapters (Layer 4)

The SPA adapters (Layer 3) and the server/client transports (Layer 2) handle the protocol — but they don't handle the **full developer experience** in fullstack meta-frameworks like Next.js, Nuxt, and SvelteKit. These frameworks have their own conventions for data fetching, server/client boundaries, state management, and cache invalidation. A clean SLOP integration must work *with* those conventions, not around them.

Meta-framework adapters are a layer above the protocol. The protocol is completely agnostic to what uses it — it is the adapter's job to compose and keep state in sync using the framework's own patterns.

#### The core model: per-session trees, server owns state, client reports UI

In a multi-user web app, each user session sees different data — different permissions, different records, different UI context. The SLOP tree is therefore **per-session**, not shared. Each session gets its own `SlopServer` instance with its own tree, version, subscriptions, and UI state.

The protocol is unchanged — it defines communication between one provider and one consumer. Session management is the backend's responsibility: authenticating the request, creating or retrieving a `SlopServer` for that session, and routing the WebSocket connection to the right instance. This is no different from how web apps already handle sessions.

```
┌─ Backend ──────────────────────────────────────────────┐
│                                                         │
│  Session A (User Alice, admin)         Session B (User Bob, viewer)
│  ┌───────────────────────────┐         ┌──────────────────────────┐
│  │ SlopServer instance       │         │ SlopServer instance      │
│  │ ├── projects (3 items)    │         │ ├── projects (1 item)    │
│  │ │   actions: create,delete│         │ │   actions: (view only) │
│  │ └── ui/                   │         │ └── ui/                  │
│  │     ├── route: /projects  │         │     ├── route: /         │
│  │     └── filters: active   │         │     └── filters: all     │
│  └───────────────────────────┘         └──────────────────────────┘
│              ↕ WebSocket                       ↕ WebSocket
│         Alice's browser                    Bob's browser
│         Alice's AI agent                   Bob's AI agent
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The adapter handles session routing:

```ts
// WebSocket handler — app provides auth, adapter routes to the right instance
message(peer, msg) {
  const session = getSessionFromAuth(peer);   // app's auth logic
  const slop = getOrCreateSlop(session);      // app manages SlopServer instances
  slop.handleMessage(conn, msg);              // standard SLOP protocol from here
}
```

Within each session, the tree manages two categories of state:

1. **Data state** — domain data scoped to the user. Registered via descriptor functions that receive the session/user context.
2. **UI state** — what this specific user is seeing and doing. Registered by their browser via the bidirectional connection, placed under a `ui/` prefix.

```
root (my-app)                          ← one tree per session
├── todos              ← data state (server, user-scoped)
│   ├── todo-1         ← actions: toggle, delete
│   └── todo-2
├── categories         ← data state (server)
└── ui                 ← UI state (from this user's browser, pinned)
    ├── route          ← auto: { path: "/dashboard" }
    ├── filters        ← { category: "work", status: "active" }
    │                    actions: ui_set_filter
    ├── selection      ← { id: "todo-1" }
    └── compose        ← { title: "Buy milk", expanded: true }
                         actions: ui_type, ui_submit, ui_close
```

AI consumers connect to the server's WebSocket and see the complete picture for **their** session: the user's data AND the user's current UI context. The extension acts purely as a consumer or bridge — it has no role in composing the tree.

#### The bidirectional connection

When the browser hydrates, the adapter opens a bidirectional connection to the server (typically the same WebSocket endpoint). This connection serves three purposes:

```
Client → Server:  UI state registration
                  register("ui/filters", { type: "status", props: { category: "work" }, actions: { ... } })
                  unregister("ui/compose")  // user closed the form

Server → Client:  UI action forwarding
                  { type: "invoke_ui", path: "ui/compose", action: "ui_type", params: { value: "Buy milk" } }

Server → Client:  Data invalidation
                  { type: "data_changed", paths: ["/todos"] }
```

The client uses the same `register(path, descriptor)` format from `@slop-ai/core` to report UI state. The server merges these registrations into the tree under the `ui/` prefix. When the client navigates or unmounts components, it sends `unregister` — the `ui/` subtree updates naturally.

#### Action routing: data actions vs UI actions

The tree contains two kinds of actions, distinguished by convention:

| Action type | Example | Where the handler runs | How it's invoked |
|---|---|---|---|
| Data action | `toggle` on `todos/todo-1` | Server (descriptor function handler) | AI invokes → server executes → auto-refresh |
| UI action | `ui_type` on `ui/compose` | Client (registered via bidirectional connection) | AI invokes → server forwards to client → client executes → client reports state update |

The `ui_` prefix helps the AI understand the difference:
- `add_todo` — creates a todo directly (efficient, no UI side effects)
- `ui_submit` on `ui/compose` — submits the compose form (creates todo AND clears form AND shows feedback — the user sees the action happen)

The AI chooses based on intent: silent efficiency vs visible collaboration with the user.

When the server receives an invoke for a `ui/` path, it forwards the invocation to the client via the bidirectional connection. The client looks up the handler locally, executes it, and reports the updated UI state back. The server updates the tree and sends the result to the AI consumer.

#### UI sync: the data invalidation problem

When an AI (or any SLOP consumer) invokes a data action — e.g., `add_todo` — the server state changes and the tree updates. But the browser UI may be showing stale data from its last fetch.

The adapter solves this with a `data_changed` signal sent to the client via the bidirectional connection. The signal includes the paths that changed. The client then uses the framework's native invalidation mechanism:

| Framework | Invalidation trigger |
|---|---|
| Next.js | `router.refresh()` or selective `revalidatePath` |
| Nuxt | `refreshNuxtData()` |
| SvelteKit | `invalidateAll()` or selective `invalidate()` |

**Selective invalidation:** If the server changed `/contacts` but the current page only renders `/todos`, the adapter can skip the re-fetch. The adapter knows what changed (from the tree diff) and what the current page depends on (from the framework's data dependencies). This is an optimization the adapter implements, not the protocol.

#### Hydration race condition

Between SSR and client hydration, the AI may invoke actions that change server state. The `data_changed` signal is lost because the bidirectional connection doesn't exist yet.

**Solution: version check on connect.** The adapter embeds the tree version in the SSR response (e.g., as a data attribute or serialized prop). When the client hydrates and connects, it sends the version it was rendered with:

```
Client connects:  { type: "hydrate", dataVersion: 5, route: "/dashboard" }
Server checks:    current version is 7 → stale
Server responds:  { type: "data_changed" }
Client re-fetches.
```

If versions match, no re-fetch needed. The tree version is already tracked by `@slop-ai/server`. The adapter just needs to embed and compare it.

#### Multiple browser tabs

Multiple tabs from the same user share the same session (and therefore the same `SlopServer` instance). Each tab establishes its own bidirectional connection and sends its own UI state. The server models them as children under the `ui/` node:

```
ui/
├── tab-abc123           ← active tab (meta.pinned: true, not collapsible)
│   ├── route: "/todos"
│   ├── filters
│   └── compose
└── tab-def456           ← inactive tab (collapsible by auto-compaction)
    ├── route: "/settings"
    └── theme-picker
```

The active tab (most recently focused) has `meta.pinned: true` — it is always visible to the AI. Inactive tabs can be collapsed by auto-compaction. The `ui/` node itself should also be pinned to ensure it is never collapsed.

For v1, single-tab is the primary use case. The multi-tab model is a natural extension.

#### What each adapter handles

| Concern | Next.js (`@slop-ai/next`) | Nuxt (`@slop-ai/nuxt`) | SvelteKit (`@slop-ai/sveltekit`) |
|---|---|---|---|
| Server endpoint | Custom server + `attachSlop` | Nitro WebSocket handler (module auto-configures) | Vite plugin + adapter-node |
| Bidirectional connection | WebSocket to custom server | WebSocket to Nitro | WebSocket via Vite plugin (dev) / adapter-node (prod) |
| UI sync trigger | `router.refresh()` or `revalidatePath` | `refreshNuxtData()` | `invalidateAll()` |
| Client state registration | `useSlop()` via `@slop-ai/react`, auto-prefixed `ui/` | `useSlop()` via `@slop-ai/vue`, auto-prefixed `ui/` | `register()` via `@slop-ai/client`, auto-prefixed `ui/` |
| Version embedding | Server component prop or `<script>` tag | Nuxt payload | SvelteKit load data |
| Configuration | `withSlop()` in next.config | `modules: ["@slop-ai/nuxt"]` | `slopPlugin()` in vite.config |
| Discovery | `<meta>` injected by layout component | `<meta>` injected by module | `<meta>` in app.html |

#### Developer experience goals

The ideal experience for a Nuxt developer:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@slop-ai/nuxt"],
});
```

```ts
// server/slop/todos.ts — register server state
export default defineSlopNode("todos", () => ({
  type: "collection",
  props: { count: getTodos().length },
  items: getTodos().map(t => ({
    id: t.id,
    props: { title: t.title, done: t.done },
    actions: {
      toggle: () => toggleTodo(t.id),
      delete: { handler: () => deleteTodo(t.id), dangerous: true },
    },
  })),
}));
```

```vue
<!-- pages/index.vue — UI auto-syncs when AI changes state -->
<script setup>
const { data: todos } = useFetch("/api/todos");

// Expose UI state — auto-prefixed under ui/, auto-synced to server
const filter = ref("all");
useSlop("filters", () => ({
  type: "status",
  props: { category: filter.value },
  actions: {
    ui_set_filter: {
      params: { category: "string" },
      handler: (params) => { filter.value = params.category; },
    },
  },
}));
// No manual WebSocket code. The module handles everything.
</script>
```

The developer registers server state in server files (descriptor functions), registers UI state in components (`useSlop` with `ui_` prefixed actions), and the module handles the bidirectional connection, tree composition, invalidation, and discovery.

#### Separation of concerns

The protocol (Layers 0–2) handles:
- State tree structure, affordances, patches
- Transport (WebSocket, postMessage, Unix, stdio)
- Discovery (meta tags, well-known URLs, provider files)

The meta-framework adapter (Layer 4) handles:
- Bidirectional connection between client and server
- UI state registration (register/unregister over the connection)
- UI action forwarding (server → client invoke routing)
- Data invalidation (server → client change notification)
- Hydration version checking
- Framework-native configuration and conventions

This separation means:
- The protocol never needs to know about `revalidatePath` or `invalidateAll`
- Framework adapters can evolve independently of the protocol
- New frameworks can be supported without protocol changes
- The protocol remains testable and portable across any JavaScript environment
- The `ui_` action prefix and `ui/` tree prefix are conventions, not protocol features

## Tier 2: Framework adapter

A browser extension hooks into the app's frontend framework to extract structured state. No app changes required, but the state is less semantic than a native integration.

### How it works

Modern frontend frameworks maintain a virtual representation of the UI:

- **React** — fiber tree with component state and props
- **Vue** — reactive dependency graph with component instances
- **Svelte** — compiled reactive variables
- **Redux/Zustand/MobX/Pinia** — external state stores

An extension can access these through the same mechanisms that DevTools extensions use (e.g., `__REACT_DEVTOOLS_GLOBAL_HOOK__`).

### Mapping framework state to SLOP

```
Framework concept          SLOP mapping
───────────────────────────────────────────────
Component tree root    →   type: "root"
Route / page component →   type: "view"
List component         →   type: "collection"
List item component    →   type: "item"
Form component         →   type: "form"
Input element          →   type: "field", properties.value
Button element         →   type: "control", affordance: { action: "click" }
Component props/state  →   properties
Store state slice      →   subtree
```

### Affordances from the framework

- **onClick handlers** → `{ action: "click" }`
- **onSubmit handlers** → `{ action: "submit" }`
- **Input elements** → `{ action: "fill", params: { value: "string" } }`
- **Links / router navigation** → `{ action: "navigate", params: { to: "string" } }`

These are generic — the adapter doesn't know the domain meaning of a click. A native SLOP integration would expose `{ action: "archive" }` instead of `{ action: "click" }`.

### Change detection

- **React**: Subscribe to fiber tree updates via DevTools hook
- **Redux/Zustand**: `store.subscribe()` — the store itself notifies on change
- **Vue**: Reactivity system triggers watchers automatically
- **Generic**: `MutationObserver` on the DOM as a fallback

Debounce at 50–100ms to batch rapid framework re-renders into single SLOP patches.

## Tier 3: Accessibility tree adapter

The most generic approach. Works on any web page without any app cooperation. A browser extension reads the browser's accessibility tree and maps it to SLOP.

### Source: Accessibility tree

The browser computes an accessibility tree (AX tree) for every page, derived from the DOM and ARIA attributes. This tree is the same one screen readers consume.

```
AX tree node          →  SLOP node
─────────────────────────────────────
role: "main"          →  type: "view"
role: "list"          →  type: "collection"
role: "listitem"      →  type: "item"
role: "textbox"       →  type: "field"
role: "button"        →  type: "control"
name: "Send"          →  properties.label: "Send"
value: "hello"        →  properties.value: "hello"
states: ["focused"]   →  meta.focus: true
```

### Affordances from ARIA

- `role: "button"` → `{ action: "click" }`
- `role: "textbox"` → `{ action: "fill", params: { value: "string" } }`
- `role: "link"` → `{ action: "follow" }`
- `role: "checkbox"` → `{ action: "toggle" }`
- `aria-expanded: "true"` → `{ action: "collapse" }`

### Limitations

The accessibility tree is designed for screen readers, not AI. It reflects UI structure, not semantic application state. An email inbox's AX tree describes *elements on screen* (list items with text), not *emails with senders and subjects*. This is the fundamental difference from a native SLOP integration.

However, for apps that aren't SLOP-aware, the accessibility tree is far better than screenshots — it's structured, lightweight, and immediately available.

### Change detection

- `MutationObserver` on the DOM
- Debounce aggressively — UI updates at 60fps, SLOP patches at 1–10/second max

## Extension architecture

A SLOP browser extension acts as a bridge between web apps and AI consumers. It supports all three tiers, choosing the best available source for each page.

```
┌─ Extension ────────────────────────────────┐
│                                             │
│  1. Check for <meta name="slop">            │  → Tier 1: connect directly
│  2. Check for framework DevTools hooks       │  → Tier 2: build from framework state
│  3. Fall back to accessibility tree          │  → Tier 3: build from AX tree
│                                             │
│  Expose the resulting SLOP provider to:     │
│  - Local AI agents (via native messaging)   │
│  - Remote consumers (via WebSocket server)  │
│                                             │
└─────────────────────────────────────────────┘
```

### Discovery cascade

When the extension loads on a page, it checks for SLOP support in order:

1. **Meta tag**: `<meta name="slop" content="...">` — the app is SLOP-native. The extension connects as a consumer (or simply surfaces the connection info to local AI agents).
2. **Framework hooks**: `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`, `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`, etc. — framework state is available. The extension builds an adapter.
3. **Accessibility tree**: Always available. The extension builds a generic adapter.

The extension should prefer higher tiers — if a meta tag is present, don't also build a framework adapter for the same page.

## Design principles for web integration

1. **SLOP-native is always better than adapted.** Encourage app developers to implement SLOP directly rather than relying on adapters. A 50-line SLOP integration in the app beats a 500-line generic adapter in an extension.

2. **The protocol doesn't change across tiers.** Whether the state tree comes from a native provider, a framework adapter, or the accessibility tree, consumers see the same SLOP protocol. The quality of the tree varies, but the interface is identical.

3. **Same state, multiple consumers.** A web app's SLOP provider should serve any number of consumers — browser extensions, local AI agents, remote tools. The provider is the single source of truth; consumers are interchangeable.

4. **Transport matches the architecture.** Server-backed apps use WebSocket. Client-only SPAs use postMessage. Both are SLOP transports. The app's architecture determines the transport, not the protocol.

5. **Adapt to state, not to state libraries.** The `register(id, descriptor)` API works with any state source — React useState, Zustand, Redux, MobX, Vue refs, Svelte runes, or plain variables. No per-library adapters.

6. **Don't invade the UI layer.** SLOP declarations live in the component logic (next to `useState`), not in the template (JSX/HTML). The UI should be completely SLOP-free.

7. **No contexts, no providers.** The `SlopClient` is a plain object you create and import — like TanStack's `QueryClient`. Framework adapters are hooks that call `register`/`unregister`, not context providers that wrap the component tree.

8. **Distributed, not centralized.** Each component registers its own SLOP nodes near the state it owns. Components don't know about each other's nodes. The client assembles the full tree. When a component unmounts, its nodes disappear.

9. **Developer-friendly names.** The descriptor API uses `props`, `actions`, `items` — not `properties`, `affordances`, `children`. Handlers are callbacks, not action name strings. The library translates to protocol format internally.

10. **The tree is a curated projection.** Developers choose what to expose — SLOP doesn't dump internal state. The semantic mapping is inherently app-specific. Libraries reduce boilerplate but don't attempt to auto-generate semantic meaning.

11. **Descriptor functions, not manual tree building.** On the server, `register()` accepts a function that returns a descriptor. The server re-evaluates it after invocations and on explicit `refresh()`. Developers never construct wire-format trees or manage subscriptions by hand — the SDK handles the reactivity gap.

12. **Attach to existing servers, don't replace them.** `attachSlop(slop, httpServer)` adds a SLOP WebSocket endpoint alongside existing routes. It doesn't create its own server, claim a port, or interfere with routing. One more endpoint, like any other.

13. **Shared engine, separate transports.** `@slop-ai/core` is the engine — tree assembly, diffing, descriptor format. `@slop-ai/client` and `@slop-ai/server` are transport shells. Learn `register()` once, use it everywhere — browser, server, CLI, native app.

14. **The protocol is framework-agnostic. Adapters are not.** The SLOP protocol handles state exposure and AI interaction. How the browser UI stays in sync, how server/client state is composed, and how the endpoint is configured — these are framework concerns, solved by framework-specific adapters (Layer 4), not by the protocol.

15. **Trees are per-session, not shared.** In multi-user apps, each user session gets its own `SlopServer` instance with its own tree, version, and UI state. The protocol doesn't define sessions — the backend authenticates and routes connections to the correct instance, the same way it handles any session-scoped resource.
