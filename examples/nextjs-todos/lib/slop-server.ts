import { createSlopServer } from "@slop-ai/server";
import { getTodos, addTodo, toggleTodo, deleteTodo } from "./state";

export const slop = createSlopServer({ id: "nextjs-todos", name: "Next.js Todos" });

slop.register("todos", () => ({
  type: "collection",
  props: { count: getTodos().length, done: getTodos().filter(t => t.done).length },
  actions: {
    add_todo: {
      params: { title: "string" },
      handler: (params) => addTodo(params.title as string),
    },
  },
  items: getTodos().map(t => ({
    id: t.id,
    props: { title: t.title, done: t.done },
    actions: {
      toggle: () => toggleTodo(t.id),
      delete: { handler: () => deleteTodo(t.id), dangerous: true },
    },
  })),
}));
