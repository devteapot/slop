---
title: Quick Start
description: Add SLOP to your app in 5 minutes
---

SLOP lets AI see your app's state as a semantic tree and act on it through contextual affordances. Here's what that looks like — this is what an AI consumer sees when connected to a SLOP-enabled todo app:

```
[root] My App
  [collection] todos (count=2, done=1)
    [item] todo-1
      props: { title: "Read the SLOP spec", done: true }
      actions: [toggle, delete]
    [item] todo-2
      props: { title: "Build the MVP", done: false }
      actions: [toggle, delete]
    actions: [create]
```

The AI doesn't parse screenshots or call blind tools. It subscribes to this tree, receives patches as state changes, and invokes actions directly on the nodes they belong to.

## 1. Install

```bash
bun add @slop-ai/client @slop-ai/react
```

## 2. Create the client

One instance per app. Import it from any component.

```ts
// slop.ts
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({ id: "my-app", name: "My App" });
```

This starts a SLOP provider in the browser. It handles transport, tree assembly, diffing, and patch delivery automatically.

## 3. Register state

Use the `useSlop` hook to expose component state. Place it next to your `useState`, not in JSX.

```tsx
import { useState } from "react";
import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";

function TodoList() {
  const [todos, setTodos] = useState([
    { id: "1", title: "Read the SLOP spec", done: true },
    { id: "2", title: "Build the MVP", done: false },
  ]);

  useSlop(slop, "todos", {
    type: "collection",
    props: { count: todos.length, done: todos.filter(t => t.done).length },
    actions: {
      create: {
        params: { title: "string" },
        handler: ({ title }) => {
          setTodos(prev => [...prev, {
            id: Date.now().toString(), title, done: false,
          }]);
        },
      },
    },
    items: todos.map(todo => ({
      id: todo.id,
      props: { title: todo.title, done: todo.done },
      actions: {
        toggle: () => setTodos(prev =>
          prev.map(t => t.id === todo.id ? { ...t, done: !t.done } : t)
        ),
        delete: {
          handler: () => setTodos(prev => prev.filter(t => t.id !== todo.id)),
          dangerous: true,
        },
      },
    })),
  });

  return (
    <ul>
      {todos.map(t => (
        <li key={t.id}>
          {t.done ? "✓" : "○"} {t.title}
        </li>
      ))}
    </ul>
  );
}
```

When this component renders, SLOP assembles the tree shown at the top of this page. When state changes, it diffs and pushes patches. When the AI invokes `toggle`, the handler runs your React state setter. Your UI stays completely SLOP-free — no special components, no wrappers.

## 4. See it working

Your app is now a SLOP provider. To verify, connect a consumer.

**Option A: Browser extension** — Install the [SLOP extension](/extension/install). It discovers the provider automatically via a `<meta name="slop">` tag that the client injects. Open the extension sidebar to see the live tree and chat with it.

**Option B: CLI consumer** — Connect programmatically:

```ts
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new WebSocketClientTransport("ws://localhost:3000/slop")
);

await consumer.connect();
const tree = await consumer.query("/");
console.log(tree);
```

**Option C: Run the demo** — `bun run demo` from the repo root starts a SLOP-enabled app with a pre-configured consumer that shows the full observe-and-act loop.

## How it works

```
Component A: slop.register("todos", { ... })
Component B: slop.register("settings", { ... })
                    ↓
        @slop-ai/core assembles hierarchical tree
                    ↓
        @slop-ai/client diffs and pushes patches
                    ↓
        AI consumer subscribes → sees tree → invokes actions
                    ↓
        Handler runs → state changes → new patches
```

Each component registers its own slice of the tree. Components don't know about each other's nodes. When a component unmounts, its nodes disappear automatically.

## Pick your path

<div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1rem;">

| Path | Guide |
|---|---|
| **React / Vue / Solid / Angular** | [React](/guides/react), [Vue](/guides/vue), [Solid](/guides/solid), [Angular](/guides/angular) |
| **Vanilla JS / Svelte** | Use `@slop-ai/client` directly — [Vanilla](/guides/vanilla), [Svelte](/guides/svelte) |
| **Server-backed web app** | [Server & Native Apps](/guides/server-apps) |
| **TanStack Start (fullstack)** | [TanStack Start](/guides/tanstack-start) |
| **Python** | [Python guide](/guides/python) — FastAPI, CLI, desktop |
| **Go** | [Go guide](/guides/go) — net/http, CLI, daemons |
| **Rust** | [Rust guide](/guides/rust) — axum, CLI, embedded |
| **Build an AI consumer** | [Consumer guide](/guides/consumer) |

</div>
