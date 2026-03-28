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

#### The core contract

SLOP integration requires only three things from the app:

```
1. Give me your current state     →  () => State
2. Tell me when it changes        →  subscribe(callback)
3. Here's an action to run        →  handler(params, path)
```

Every state management approach — React useState, Zustand, Redux, MobX, Jotai, Vue refs, Svelte runes, or a plain variable — already provides #1 and #2. This is the universal contract that SLOP binds to.

This means **SLOP does not need adapters for individual state management libraries**. A single integration point works with any state source, as long as it can return current state and notify on change.

#### Framework-agnostic core

The lowest-level API is framework-agnostic. The app provides a subscribe function, a tree builder, and handlers:

```js
import { createSlop } from "@slop/core";

const slop = createSlop({
  id: "my-app",
  subscribe: (onChange) => store.subscribe(onChange),
  tree: () => buildTree(store.getState()),
});

slop.on("add_todo", ({ title }) => store.dispatch(addTodo(title)));
slop.on("toggle", (_, path) => store.dispatch(toggle(extractId(path))));
slop.on("delete", (_, path) => store.dispatch(remove(extractId(path))));
```

This works with any store — Zustand, Redux, MobX, a plain object with an event emitter, or anything else. The core doesn't know or care what manages the state.

#### Framework bindings

Framework bindings are thin wrappers (~10–20 lines each) that adapt the core to each framework's reactivity model. They handle **when to re-run the tree builder** — nothing more.

**React:**

```tsx
function TodoApp() {
  const [todos, setTodos] = useState(initialTodos);

  const slop = useSlop("todo-app", () => ({
    id: "root",
    type: "root",
    children: [
      {
        id: "todos",
        type: "collection",
        properties: { count: todos.length },
        children: todos.map(todo => ({
          id: todo.id,
          type: "item",
          properties: { title: todo.title, done: todo.done },
          affordances: [{ action: "toggle" }, { action: "delete", dangerous: true }],
        })),
      },
    ],
    affordances: [{ action: "add_todo", params: { title: { type: "string" } } }],
  }));

  slop.on("add_todo", ({ title }) => setTodos(t => [...t, makeTodo(title)]));
  slop.on("toggle", (_, path) => setTodos(t => toggleById(t, extractId(path))));
  slop.on("delete", (_, path) => setTodos(t => t.filter(x => x.id !== extractId(path))));

  // UI is completely SLOP-free
  return <div>{todos.map(t => <TodoItem key={t.id} todo={t} />)}</div>;
}
```

**Vue:**

```js
const slop = useSlop("todo-app", () => buildTree(todos.value));

slop.on("toggle", (_, path) => toggleTodo(extractId(path)));
```

**Svelte:**

```js
const slop = useSlop("todo-app", () => buildTree(todos));

slop.on("toggle", (_, path) => toggleTodo(extractId(path)));
```

The pattern is identical across frameworks: a hook/composable takes an ID and a tree builder function, returns an object with `.on()` for registering handlers. The JSX/template is untouched.

#### What each layer does

```
┌──────────────────────────────────────────────┐
│  @slop/core                                   │  Provider, diffing, patches,
│  (browser build, framework-agnostic)          │  PostMessage + WebSocket transport,
│                                               │  subscribe/tree/handlers contract
└─────────────────────┬────────────────────────┘
                      │
           ┌──────────┼──────────┐
           │          │          │
      @slop/react  @slop/vue  @slop/svelte       10–20 lines each,
      (useSlop)    (useSlop)   (useSlop)          wires framework reactivity
```

The core does the real work. Framework bindings are so thin they could be documented examples rather than separate packages. No state-library-specific adapters are needed — the `subscribe + tree function` contract is universal.

#### Tree building DX

The tree builder is the part the developer writes by hand. This is the main integration cost. Several approaches, from most explicit to most concise:

**Raw SLOP nodes** — full control, verbose:

```js
tree: () => ({
  id: "root", type: "root",
  children: [{
    id: "todos", type: "collection",
    properties: { count: todos.length },
    children: todos.map(todo => ({
      id: todo.id, type: "item",
      properties: { title: todo.title, done: todo.done },
      affordances: [{ action: "toggle" }],
    })),
  }],
})
```

**Builder helpers** — less boilerplate, still explicit:

```js
import { root, collection, item } from "@slop/helpers";

tree: () => root("Todo App",
  collection("todos", todos, todo =>
    item(todo.id, { title: todo.title, done: todo.done }, [
      { action: "toggle" },
      { action: "delete", dangerous: true },
    ])
  ),
)
```

**Compact format** — convention over configuration:

```js
tree: () => ({
  todos: todos.map(todo => ({
    $type: "item",
    title: todo.title,
    done: todo.done,
    $afford: ["toggle", { action: "delete", dangerous: true }],
  })),
})
```

In the compact format, `$type`, `$afford`, and `$meta` are reserved keys. Everything else becomes a property or a child. The library expands it to the full SLOP node structure. This trades some explicitness for significantly less boilerplate.

The right approach depends on the app and the developer's preference. All three produce the same SLOP tree — they're syntactic choices, not protocol choices.

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

5. **Adapt to state, not to state libraries.** SLOP needs two things from the app: current state and change notification. Every state management approach already provides both. Build one universal contract (`subscribe` + `tree function`), not per-library adapters.

6. **Don't invade the UI layer.** SLOP integration belongs alongside state management, not in the component tree. The tree is derived from state, not from JSX/templates. The UI should be completely SLOP-free.

7. **The tree is a curated projection.** Developers choose what to expose — SLOP doesn't dump internal state. The semantic mapping (what does this data *mean*?) is inherently app-specific and should stay that way. Libraries can reduce boilerplate (helpers, compact format) but should not attempt to auto-generate semantic meaning.
