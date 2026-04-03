export const STARTER_CODE = `const todos = [
  { id: "todo-1", title: "Read the SLOP spec", done: true },
  { id: "todo-2", title: "Build the MVP", done: false },
];

register("todos", {
  type: "collection",
  props: { count: todos.length },
  actions: {
    create: {
      params: { title: "string" },
      handler: ({ title }) => {
        todos.push({ id: "todo-" + Date.now(), title, done: false });
      },
    },
  },
  items: todos.map(todo => ({
    id: todo.id,
    props: { title: todo.title, done: todo.done },
    actions: {
      toggle: () => { todo.done = !todo.done; },
      rename: {
        params: { title: "string" },
        handler: ({ title }) => { todo.title = title; },
      },
      delete: {
        handler: () => {
          const i = todos.indexOf(todo);
          if (i !== -1) todos.splice(i, 1);
        },
        dangerous: true,
      },
    },
  })),
});`;
