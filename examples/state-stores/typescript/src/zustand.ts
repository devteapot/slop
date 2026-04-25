import { createSlop, exposeStore } from "@slop-ai/client";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createTodo, createTodoIdFactory, projectTodos, type Todo, type TodoExample } from "./shared";

interface TodoState {
  todos: Todo[];
  addTodo(title: string): Todo;
  toggleTodo(id: string): void;
  clearDone(): void;
}

export function createZustandExample(): TodoExample & {
  store: StoreApi<TodoState>;
} {
  const nextId = createTodoIdFactory();

  const store = createStore<TodoState>()((set) => ({
    todos: [],
    addTodo: (title) => {
      const todo = createTodo(title, nextId);
      set((state) => ({ todos: [...state.todos, todo] }));
      return todo;
    },
    toggleTodo: (id) => {
      set((state) => ({
        todos: state.todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
      }));
    },
    clearDone: () => {
      set((state) => ({
        todos: state.todos.filter((todo) => !todo.done),
      }));
    },
  }));

  const slop = createSlop({
    id: "zustand-todos",
    name: "Zustand Todos",
    transports: [],
  });

  const dispose = exposeStore(slop, "todos", store, (state) =>
    projectTodos({
      todos: state.todos,
      addTodo: state.addTodo,
      toggleTodo: state.toggleTodo,
      clearDone: state.clearDone,
    }),
  );

  return {
    store,
    slop,
    dispose,
    getTodos: () => store.getState().todos,
    addTodo: (title) => store.getState().addTodo(title),
    toggleTodo: (id) => store.getState().toggleTodo(id),
    clearDone: () => store.getState().clearDone(),
  };
}
