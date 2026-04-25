# State Stores

Use `exposeStore()` when your app state already lives in a state library. The helper binds any store-like object with `getState()` and `subscribe()` to one SLOP node. You still provide the projection from application state to SLOP descriptors, so consumers see semantic app state instead of a raw state dump.

Runnable TypeScript examples live in `examples/state-stores/typescript` and cover Zustand, Redux Toolkit, Jotai, MobX, and Valtio. They all expose the same todo tree and are validated with `bun test`.

```sh
cd examples/state-stores/typescript
bun test
bun run build
```

## Basic Pattern

```ts
import { createSlop, exposeStore } from "@slop-ai/client";

const slop = createSlop({ id: "my-app", name: "My App" });

const dispose = exposeStore(slop, "status", store, (state) => ({
  type: "status",
  props: { ready: state.ready },
}));

dispose();
```

`@slop-ai/client` is usually the right import for browser apps. `@slop-ai/core` also exports `exposeStore()` for lower-level integrations that already have a provider target.

## Shared Projection

Keep your library-specific code focused on state reads, subscriptions, and mutations. The SLOP projection can be shared across libraries.

```ts
import { action, type NodeDescriptor } from "@slop-ai/client";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

function projectTodos(input: {
  todos: readonly Todo[];
  addTodo(title: string): void;
  toggleTodo(id: string): void;
  clearDone(): void;
}): NodeDescriptor {
  const done = input.todos.filter((todo) => todo.done).length;

  return {
    type: "collection",
    props: {
      count: input.todos.length,
      done,
      open: input.todos.length - done,
    },
    actions: {
      create: action({ title: "string" }, ({ title }) => input.addTodo(title)),
      clear_done: action(() => input.clearDone(), { dangerous: true }),
    },
    items: input.todos.map((todo) => ({
      id: todo.id,
      props: { title: todo.title, done: todo.done },
      actions: {
        toggle: action(() => input.toggleTodo(todo.id)),
      },
    })),
  };
}
```

## Zustand

Zustand vanilla stores and React hook stores both expose `getState()` and `subscribe()`, so they can be passed directly.

```ts
import { createSlop, exposeStore } from "@slop-ai/client";
import { createStore } from "zustand/vanilla";

const store = createStore<TodoState>()((set) => ({
  todos: [],
  addTodo: (title) => set((state) => ({ todos: [...state.todos, createTodo(title)] })),
  toggleTodo: (id) =>
    set((state) => ({
      todos: state.todos.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo,
      ),
    })),
  clearDone: () => set((state) => ({ todos: state.todos.filter((todo) => !todo.done) })),
}));

const slop = createSlop({ id: "zustand-todos", name: "Zustand Todos" });

export const dispose = exposeStore(slop, "todos", store, (state) =>
  projectTodos({
    todos: state.todos,
    addTodo: state.addTodo,
    toggleTodo: state.toggleTodo,
    clearDone: state.clearDone,
  }),
);
```

See `examples/state-stores/typescript/src/zustand.ts`.

## Redux Toolkit

Redux stores also match the `getState()` and `subscribe()` shape. SLOP actions should dispatch normal Redux actions instead of mutating state directly.

```ts
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { createSlop, exposeStore } from "@slop-ai/client";

const todosSlice = createSlice({
  name: "todos",
  initialState: { items: [] } as { items: Todo[] },
  reducers: {
    todoAdded(state, action) {
      state.items.push(action.payload);
    },
    todoToggled(state, action) {
      const todo = state.items.find((item) => item.id === action.payload);
      if (todo) todo.done = !todo.done;
    },
    doneCleared(state) {
      state.items = state.items.filter((todo) => !todo.done);
    },
  },
});

const store = configureStore({ reducer: { todos: todosSlice.reducer } });
const { doneCleared, todoAdded, todoToggled } = todosSlice.actions;

const slop = createSlop({ id: "redux-toolkit-todos", name: "Redux Toolkit Todos" });

export const dispose = exposeStore(
  slop,
  "todos",
  store,
  (state) =>
    projectTodos({
      todos: state.todos.items,
      addTodo: (title) => store.dispatch(todoAdded(createTodo(title))),
      toggleTodo: (id) => store.dispatch(todoToggled(id)),
      clearDone: () => store.dispatch(doneCleared()),
    }),
  {
    equals: (previous, next) => previous.todos.items === next.todos.items,
  },
);
```

See `examples/state-stores/typescript/src/redux-toolkit.ts`.

## Jotai

Jotai's vanilla store is atom-first, so wrap the atoms you want to expose in a small SLOP store object.

```ts
import { createSlop, exposeStore, type StateStore } from "@slop-ai/client";
import { atom, createStore } from "jotai/vanilla";

const todosAtom = atom<Todo[]>([]);
const store = createStore();

const slopStore: StateStore<{ todos: Todo[] }> = {
  getState: () => ({ todos: store.get(todosAtom) }),
  subscribe: (listener) => store.sub(todosAtom, listener),
};

const slop = createSlop({ id: "jotai-todos", name: "Jotai Todos" });

export const dispose = exposeStore(slop, "todos", slopStore, (state) =>
  projectTodos({
    todos: state.todos,
    addTodo: (title) => store.set(todosAtom, (todos) => [...todos, createTodo(title)]),
    toggleTodo: (id) =>
      store.set(todosAtom, (todos) =>
        todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
      ),
    clearDone: () => store.set(todosAtom, (todos) => todos.filter((todo) => !todo.done)),
  }),
);
```

See `examples/state-stores/typescript/src/jotai.ts`.

## MobX

MobX needs an adapter that converts observable changes into a subscription. `reaction()` works well because it lets you choose exactly which observable fields affect the SLOP projection.

```ts
import { createSlop, exposeStore, type StateStore } from "@slop-ai/client";
import { makeAutoObservable, reaction } from "mobx";

class TodoStore {
  todos: Todo[] = [];

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  addTodo(title: string) {
    this.todos.push(createTodo(title));
  }

  toggleTodo(id: string) {
    const todo = this.todos.find((item) => item.id === id);
    if (todo) todo.done = !todo.done;
  }

  clearDone() {
    this.todos = this.todos.filter((todo) => !todo.done);
  }
}

const store = new TodoStore();

const slopStore: StateStore<TodoStore> = {
  getState: () => store,
  subscribe: (listener) =>
    reaction(
      () => store.todos.map((todo) => [todo.id, todo.title, todo.done] as const),
      () => listener(),
    ),
};

const slop = createSlop({ id: "mobx-todos", name: "MobX Todos" });

export const dispose = exposeStore(slop, "todos", slopStore, (state) =>
  projectTodos({
    todos: state.todos,
    addTodo: state.addTodo,
    toggleTodo: state.toggleTodo,
    clearDone: state.clearDone,
  }),
);
```

See `examples/state-stores/typescript/src/mobx.ts`.

## Valtio

Valtio proxies expose changes through `subscribe()`. Use `snapshot()` in `getState()` so the projection reads a stable value.

```ts
import { createSlop, exposeStore, type StateStore } from "@slop-ai/client";
import { proxy, snapshot, subscribe } from "valtio/vanilla";

const state = proxy<{ todos: Todo[] }>({ todos: [] });

const slopStore: StateStore<{ todos: Todo[] }> = {
  getState: () => ({ todos: [...snapshot(state).todos] }),
  subscribe: (listener) => subscribe(state, listener),
};

const slop = createSlop({ id: "valtio-todos", name: "Valtio Todos" });

export const dispose = exposeStore(slop, "todos", slopStore, () =>
  projectTodos({
    todos: state.todos,
    addTodo: (title) => state.todos.push(createTodo(title)),
    toggleTodo: (id) => {
      const todo = state.todos.find((item) => item.id === id);
      if (todo) todo.done = !todo.done;
    },
    clearDone: () => {
      state.todos = state.todos.filter((todo) => !todo.done);
    },
  }),
);
```

See `examples/state-stores/typescript/src/valtio.ts`.

## Options

Use `equals` when a store emits for changes that do not affect the SLOP projection.

Use `debounceMs` when a store emits many updates in a short burst and projection work is expensive.

```ts
exposeStore(slop, "search", store, projectSearch, {
  equals: (previous, next) => previous.search === next.search,
  debounceMs: 50,
});
```

## Other SDKs

The Python, Go, and Rust SDKs expose the same idea for native/server apps:

```python
from slop_ai import expose_store

dispose = expose_store(slop, "todos", todo_store, lambda state: {
    "type": "collection",
    "props": {"count": len(state.todos)},
})
```

```go
dispose := slop.ExposeStore(server, "todos", todoStore, func(state TodoState) slop.Node {
	return slop.Node{Type: "collection", Props: slop.Props{"count": len(state.Todos)}}
})
defer dispose()
```

```rust
let binding = slop_ai::expose_store(slop.clone(), "todos", todo_store.clone(), |state| {
    serde_json::json!({"type": "collection", "props": {"count": state.todos.len()}})
});
```

## Guidance

Expose the state an AI agent needs, not every internal field in the store.

Keep affordances aligned with your public state operations: dispatch Redux actions, call Zustand actions, or route through your domain services. Do not let SLOP actions mutate unrelated store internals directly.

## Related Pages

- [Browser provider API](/api/client)
- [Core helpers](/api/core)
- [Vanilla JS guide](/guides/vanilla)
