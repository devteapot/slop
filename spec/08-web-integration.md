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

### Developer integration

Integrating SLOP into a web app involves two things:

1. **Tree building** — a function that maps app state to a SLOP tree. This is inherently app-specific: the developer decides what state to expose, how to structure it, and what affordances to offer. The SLOP tree is a *curated projection*, not a raw dump — just as a REST API doesn't expose the database.

2. **Affordance handlers** — callbacks that execute when the AI invokes an action. These map SLOP invocations back to the app's own state mutations.

The integration should be **non-invasive** — it should not require changes to the app's UI layer. The SLOP tree is derived from state, not from the UI. The two are separate concerns.

#### Package architecture

SLOP's client library follows the TanStack Query model: a framework-agnostic core client with minimal framework adapters. No contexts, no providers — just an object you create and import.

```
@slop-ai/core           — SlopClient class: tree assembly, diffing, transport, invocation dispatch
@slop-ai/react          — useSlop() hook (~15 lines)
@slop-ai/vue            — useSlop() composable (~10 lines)
@slop-ai/svelte         — useSlop() rune (~10 lines)
(vanilla JS)         — use @slop-ai/core directly, no adapter needed
```

The core does all the work. Framework adapters only handle one thing: registering a node on mount, updating on state change, and unregistering on unmount. No state-library-specific adapters are needed — the pattern works with useState, Zustand, Redux, MobX, Jotai, Pinia, or plain variables.

#### The core client

The app creates a single `SlopClient` instance. It's a plain JavaScript object — no framework dependency, no context, no provider.

```ts
// slop.ts — create once, import anywhere in your app
import { createSlop } from "@slop-ai/core";

export const slop = createSlop({
  id: "my-app",
  name: "My App",
  // transport is auto-detected: postMessage in browser, ws/unix in Node
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

#### What the core handles

```
Component A: slop.register("inbox", { type: "view" })
Component B: slop.register("inbox/messages", { type: "collection", items: [...] })
Component C: slop.register("inbox/unread", { type: "status", props: { count: 5 } })
Component D: slop.register("settings", { type: "view", children: { account: {...} } })
                    ↓
         @slop-ai/core assembles hierarchical tree:
         root
         ├── inbox (view)
         │   ├── messages (collection)
         │   │   ├── msg-1 (item)
         │   │   └── msg-2 (item)
         │   └── unread (status)
         └── settings (view)
             └── account (group)
                    ↓
         Diffs against previous tree
                    ↓
         Pushes patches via transport
         (postMessage or WebSocket)
                    ↓
         Receives invoke("archive", "/inbox/messages/msg-1")
                    ↓
         Routes to the handler registered in
         Component B's descriptor for msg-1
```

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
