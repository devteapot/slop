import { createSlop, exposeStore, type StateStore } from "@slop-ai/client";
import { proxy, snapshot, subscribe } from "valtio/vanilla";
import { createTodo, createTodoIdFactory, projectTodos, type Todo, type TodoExample } from "./shared";

interface ValtioTodoState {
  todos: Todo[];
}

export function createValtioExample(): TodoExample & {
  state: ValtioTodoState;
} {
  const nextId = createTodoIdFactory();
  const state = proxy<ValtioTodoState>({ todos: [] });

  const addTodo = (title: string) => {
    const todo = createTodo(title, nextId);
    state.todos.push(todo);
    return todo;
  };
  const toggleTodo = (id: string) => {
    const todo = state.todos.find((item) => item.id === id);
    if (todo) {
      todo.done = !todo.done;
    }
  };
  const clearDone = () => {
    state.todos = state.todos.filter((todo) => !todo.done);
  };

  const slopStore: StateStore<ValtioTodoState> = {
    getState: () => ({ todos: [...snapshot(state).todos] }),
    subscribe: (listener) => subscribe(state, listener),
  };

  const slop = createSlop({
    id: "valtio-todos",
    name: "Valtio Todos",
    transports: [],
  });

  const dispose = exposeStore(slop, "todos", slopStore, (current) =>
    projectTodos({
      todos: current.todos,
      addTodo,
      toggleTodo,
      clearDone,
    }),
  );

  return {
    state,
    slop,
    dispose,
    getTodos: () => state.todos,
    addTodo,
    toggleTodo,
    clearDone,
  };
}
