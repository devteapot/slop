import { createSlop, exposeStore, type StateStore } from "@slop-ai/client";
import { makeAutoObservable, reaction } from "mobx";
import { createTodo, createTodoIdFactory, projectTodos, type Todo, type TodoExample } from "./shared";

class MobxTodoStore {
  todos: Todo[] = [];

  private readonly nextId = createTodoIdFactory();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  addTodo(title: string): Todo {
    const todo = createTodo(title, this.nextId);
    this.todos.push(todo);
    return todo;
  }

  toggleTodo(id: string): void {
    const todo = this.todos.find((item) => item.id === id);
    if (todo) {
      todo.done = !todo.done;
    }
  }

  clearDone(): void {
    this.todos = this.todos.filter((todo) => !todo.done);
  }
}

export function createMobxExample(): TodoExample & {
  store: MobxTodoStore;
} {
  const store = new MobxTodoStore();

  const slopStore: StateStore<MobxTodoStore> = {
    getState: () => store,
    subscribe: (listener) =>
      reaction(
        () => store.todos.map((todo) => [todo.id, todo.title, todo.done] as const),
        () => listener(),
      ),
  };

  const slop = createSlop({
    id: "mobx-todos",
    name: "MobX Todos",
    transports: [],
  });

  const dispose = exposeStore(slop, "todos", slopStore, (state) =>
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
    getTodos: () => store.todos,
    addTodo: store.addTodo,
    toggleTodo: store.toggleTodo,
    clearDone: store.clearDone,
  };
}
