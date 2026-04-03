# Quick Start

## See it in action

<video autoplay muted loop playsinline preload="metadata" poster="/hero-demo-poster.jpg" style="width: 100%; aspect-ratio: 1440 / 900; object-fit: cover; border-radius: 8px; margin-bottom: 1rem; background: #161a23;">
  <source src="/hero-demo.mp4" type="video/mp4" />
</video>

> An AI agent browsing products, adding to cart, and writing a review — all through the SLOP protocol. Run it yourself: `bun demo`

## What SLOP does

Your app exposes a **state tree** — a semantic description of what it is and what it can do. AI subscribes to the tree, receives **patches** as things change, and triggers **actions** directly on the nodes they belong to. No screenshots, no blind tool calls.

## Add SLOP to a React app

### 1. Install

```bash
bun add @slop-ai/client @slop-ai/react
```

### 2. Create the provider

```ts
// slop.ts — one instance, import anywhere
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({ id: "my-app", name: "My App" });
```

### 3. Register state

Place `useSlop` next to your state, not in JSX. Each call registers a node in the tree.

```tsx
import { action, useSlop } from "@slop-ai/react";
import { slop } from "./slop";

function TodoList() {
  const [todos, setTodos] = useState([
    { id: "1", title: "Read the SLOP spec", done: true },
    { id: "2", title: "Build the MVP", done: false },
  ]);

  useSlop(slop, "todos", () => ({
    type: "collection",
    props: { count: todos.length },
    items: todos.map(todo => ({
      id: todo.id,
      props: { title: todo.title, done: todo.done },
      actions: {
        toggle: action(() => setTodos(prev =>
          prev.map(t => t.id === todo.id ? { ...t, done: !t.done } : t)
        )),
        delete: action(
          () => setTodos(prev => prev.filter(t => t.id !== todo.id)),
          { dangerous: true },
        ),
      },
    })),
  }));

  return <ul>{todos.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

That code produces this tree — it's what the AI sees:

```
[root] My App
  [collection] todos (count=2)
    [item] todo-1 (title="Read the SLOP spec", done=true)   actions: [toggle, delete]
    [item] todo-2 (title="Build the MVP", done=false)        actions: [toggle, delete]
```

The AI subscribes, receives patches when state changes, and invokes `toggle` or `delete` on the exact node. Your component re-renders as usual — SLOP doesn't touch your UI.

> Want to experiment? [Try it in the playground →](https://playground.slopai.dev)

### 4. See it working

Install the [SLOP browser extension](../extension/install.md). It discovers your provider automatically and shows the live tree in a sidebar. You can chat with the AI and watch it read state and invoke actions.

:::tip[No extension?]
[Try the interactive demo](https://demo.slopai.dev) in your browser, or run `bun demo` from the repo root to run it locally.
:::

## How it works

```
Your components          SLOP engine              AI consumer
─────────────────       ──────────────           ──────────────
useSlop("todos", ...)  → assembles tree         → subscribes
useSlop("settings",..) → diffs on change        → receives patches
                        → pushes patches         → invokes actions
                        → routes invokes         → sees updated tree
                        ← handler runs           ←
```

Each component registers its own slice. Components don't know about each other. When a component unmounts, its nodes disappear.

## Not using React?

SLOP works with any framework — and on the server in any language.

| Stack | Guide |
|---|---|
| **Vue / Solid / Angular / Svelte** | [Vue](/guides/vue), [Solid](/guides/solid), [Angular](/guides/angular), [Svelte](/guides/svelte) |
| **Vanilla JS** | [Use `@slop-ai/client` directly](/guides/vanilla) |
| **Server-backed web app** (Express, Fastify, Hono) | [Server & Native Apps](/guides/server-apps) |
| **Fullstack** (TanStack Start) | [TanStack Start](/guides/tanstack-start) |
| **Python** (FastAPI, CLI, desktop) | [Python guide](/guides/python) |
| **Go** (net/http, CLI, daemons) | [Go guide](/guides/go) |
| **Rust** (axum, CLI, embedded) | [Rust guide](/guides/rust) |
| **Build an AI consumer** | [Consumer guide](/guides/consumer) |
