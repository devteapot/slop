import { action, type NodeDescriptor, type SlopClient, type StoreUnsubscribe } from "@slop-ai/client";

export interface Todo {
  id: string;
  title: string;
  done: boolean;
}

export interface TodoCommands {
  addTodo(title: string): Todo;
  toggleTodo(id: string): void;
  clearDone(): void;
}

export interface TodoExample extends TodoCommands {
  slop: SlopClient;
  dispose: StoreUnsubscribe;
  getTodos(): readonly Todo[];
}

export function createTodoIdFactory(prefix = "todo"): () => string {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}

export function createTodo(title: string, nextId: () => string): Todo {
  return {
    id: nextId(),
    title,
    done: false,
  };
}

export function projectTodos(input: {
  todos: readonly Todo[];
  addTodo(title: string): Todo;
  toggleTodo(id: string): void;
  clearDone(): void;
}): NodeDescriptor {
  const done = input.todos.filter((todo) => todo.done).length;

  return {
    type: "collection",
    summary: `${input.todos.length} todos, ${input.todos.length - done} open`,
    props: {
      count: input.todos.length,
      done,
      open: input.todos.length - done,
    },
    actions: {
      create: action({ title: "string" }, ({ title }) => input.addTodo(title), { label: "Create todo" }),
      clear_done: action(() => input.clearDone(), {
        label: "Clear done todos",
        dangerous: true,
      }),
    },
    items: input.todos.map((todo) => ({
      id: todo.id,
      summary: `${todo.done ? "Done" : "Open"}: ${todo.title}`,
      props: {
        title: todo.title,
        done: todo.done,
      },
      actions: {
        toggle: action(() => input.toggleTodo(todo.id), {
          label: "Toggle todo",
        }),
      },
    })),
  };
}
