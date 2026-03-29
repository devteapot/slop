export interface Todo {
  id: string;
  title: string;
  done: boolean;
}

let todos: Todo[] = [
  { id: "1", title: "Learn SLOP protocol", done: false },
  { id: "2", title: "Build a Next.js app", done: true },
  { id: "3", title: "Connect with AI agent", done: false },
];

export function getTodos(): Todo[] {
  return todos;
}

export function addTodo(title: string): void {
  todos.push({ id: Date.now().toString(), title, done: false });
}

export function toggleTodo(id: string): void {
  const t = todos.find((t) => t.id === id);
  if (t) t.done = !t.done;
}

export function deleteTodo(id: string): void {
  todos = todos.filter((t) => t.id !== id);
}
