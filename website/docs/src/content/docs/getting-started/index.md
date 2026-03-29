---
title: Quick Start
description: Add SLOP to your app in 5 minutes
---

SLOP lets AI observe and interact with your application's state. This guide shows you how to add it to a React app. The same pattern works with Vue, Solid, Angular, Svelte, or vanilla JS.

## Install

```bash
bun add @slop-ai/core @slop-ai/react
# or: npm install @slop-ai/core @slop-ai/react
```

## Create the SLOP client

Create a file that initializes the client. You'll import this from any component that needs to expose state.

```ts
// slop.ts
import { createSlop } from "@slop-ai/core";

export const slop = createSlop({ id: "my-app", name: "My App" });
```

That's it — 3 lines. The client handles transport, diffing, and invocation routing internally.

## Register state in a component

Use the `useSlop` hook to expose a component's state to AI. Place it near your state declarations, not in the JSX.

```tsx
import { useState } from "react";
import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";

function TodoList() {
  const [todos, setTodos] = useState([
    { id: "1", title: "Read the SLOP spec", done: true },
    { id: "2", title: "Build the MVP", done: false },
  ]);

  // Expose state to AI — JSX stays SLOP-free
  useSlop(slop, "todos", {
    type: "collection",
    props: { count: todos.length },
    actions: {
      create: {
        params: { title: "string" },
        handler: ({ title }) => {
          setTodos(prev => [...prev, { id: Date.now().toString(), title: title as string, done: false }]);
        },
      },
    },
    items: todos.map(todo => ({
      id: todo.id,
      props: { title: todo.title, done: todo.done },
      actions: {
        toggle: () => setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done: !t.done } : t)),
        delete: { handler: () => setTodos(prev => prev.filter(t => t.id !== todo.id)), dangerous: true },
      },
    })),
  });

  return (
    <ul>
      {todos.map(t => <li key={t.id}>{t.title} {t.done ? "✓" : ""}</li>)}
    </ul>
  );
}
```

## What happens next

When this component renders:

1. `@slop-ai/core` assembles a SLOP state tree from all registered nodes
2. It injects a `<meta name="slop" content="postmessage">` tag into the page
3. The SLOP browser extension (or desktop app) discovers it and connects
4. The AI can see the todo list and invoke actions (create, toggle, delete)

The AI sees:
```
[root] My App
  [collection] todos (count=2)
    [item] Read the SLOP spec (done=true)  {toggle, delete}
    [item] Build the MVP (done=false)  {toggle, delete}
```

## Next steps

- [Installation guide](/getting-started/installation) — all package options
- [React guide](/guides/react) — full React integration patterns
- [Other frameworks](/guides/vue) — Vue, Solid, Angular, Svelte, vanilla JS
- [API Reference](/api/core) — `createSlop`, `register`, `scope`, typed schemas
