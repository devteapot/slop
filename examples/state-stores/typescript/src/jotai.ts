import { createSlop, exposeStore, type StateStore } from "@slop-ai/client";
import { atom, createStore } from "jotai/vanilla";
import { createTodo, createTodoIdFactory, projectTodos, type Todo, type TodoExample } from "./shared";

const todosAtom = atom<Todo[]>([]);

interface JotaiTodoState {
  todos: Todo[];
}

export function createJotaiExample(): TodoExample & {
  store: ReturnType<typeof createStore>;
  atoms: { todosAtom: typeof todosAtom };
} {
  const nextId = createTodoIdFactory();
  const store = createStore();

  const addTodo = (title: string) => {
    const todo = createTodo(title, nextId);
    store.set(todosAtom, (todos) => [...todos, todo]);
    return todo;
  };
  const toggleTodo = (id: string) => {
    store.set(todosAtom, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)));
  };
  const clearDone = () => {
    store.set(todosAtom, (todos) => todos.filter((todo) => !todo.done));
  };

  const slopStore: StateStore<JotaiTodoState> = {
    getState: () => ({ todos: store.get(todosAtom) }),
    subscribe: (listener) => store.sub(todosAtom, listener),
  };

  const slop = createSlop({
    id: "jotai-todos",
    name: "Jotai Todos",
    transports: [],
  });

  const dispose = exposeStore(slop, "todos", slopStore, (state) =>
    projectTodos({
      todos: state.todos,
      addTodo,
      toggleTodo,
      clearDone,
    }),
  );

  return {
    store,
    atoms: { todosAtom },
    slop,
    dispose,
    getTodos: () => store.get(todosAtom),
    addTodo,
    toggleTodo,
    clearDone,
  };
}
