import type { SlopNode } from "@slop/types";
import { SlopProvider, UnixServerTransport } from "@slop/provider";
import { mkdirSync } from "node:fs";

// Ensure socket directory exists
mkdirSync("/tmp/slop", { recursive: true });

const SOCKET_PATH = "/tmp/slop/slop-todo.sock";

const provider = new SlopProvider({
  id: "slop-todo",
  name: "SLOP Todo List",
  capabilities: ["state", "patches", "affordances"],
  transport: new UnixServerTransport(SOCKET_PATH),
  register: true,
});

// --- App state ---

interface Todo {
  id: string;
  title: string;
  done: boolean;
  created: string;
}

let todos: Todo[] = [
  { id: "todo-1", title: "Read the SLOP spec", done: true, created: new Date().toISOString() },
  { id: "todo-2", title: "Build the MVP", done: false, created: new Date().toISOString() },
  { id: "todo-3", title: "Test with an AI consumer", done: false, created: new Date().toISOString() },
];
let nextId = 4;

// --- Build SLOP tree from app state ---

function buildTree(): SlopNode {
  const completed = todos.filter((t) => t.done).length;
  return {
    id: "root",
    type: "root",
    properties: { label: "SLOP Todo List" },
    affordances: [
      {
        action: "add_todo",
        label: "Add Todo",
        description: "Create a new todo item",
        params: {
          type: "object",
          properties: {
            title: { type: "string", description: "Todo title" },
          },
          required: ["title"],
        },
      },
      ...(completed > 0
        ? [
            {
              action: "clear_completed",
              label: "Clear Completed",
              description: "Remove all completed todos",
            },
          ]
        : []),
      ...(todos.length - completed > 0
        ? [
            {
              action: "complete_all",
              label: "Complete All",
              description: "Mark all todos as complete",
            },
          ]
        : []),
    ],
    children: [
      {
        id: "todos",
        type: "collection",
        properties: { label: "Todos", count: todos.length },
        children: todos.map(todoToNode),
      },
      {
        id: "stats",
        type: "status",
        properties: {
          total: todos.length,
          completed,
          remaining: todos.length - completed,
        },
        meta: {
          summary: `${todos.length} total, ${completed} done, ${todos.length - completed} remaining`,
        },
      },
    ],
  };
}

function todoToNode(todo: Todo): SlopNode {
  return {
    id: todo.id,
    type: "item",
    properties: {
      title: todo.title,
      done: todo.done,
      created: todo.created,
    },
    affordances: [
      {
        action: "toggle",
        label: todo.done ? "Mark Incomplete" : "Mark Complete",
      },
      {
        action: "edit",
        label: "Edit",
        params: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
      {
        action: "delete",
        label: "Delete",
        dangerous: true,
      },
    ],
    meta: {
      salience: todo.done ? 0.2 : 0.6,
    },
  };
}

// --- Set initial tree ---
provider.setTree(buildTree());

// --- Affordance handlers ---

function rebuildAndSync() {
  provider.setTree(buildTree());
}

provider.onInvoke("add_todo", (params) => {
  const todo: Todo = {
    id: `todo-${nextId++}`,
    title: params.title as string,
    done: false,
    created: new Date().toISOString(),
  };
  todos.push(todo);
  rebuildAndSync();
  console.error(`  + Added: "${todo.title}" (${todo.id})`);
  return { id: todo.id };
});

provider.onInvoke("toggle", (_params, path) => {
  const id = path.split("/").pop()!;
  const todo = todos.find((t) => t.id === id);
  if (!todo) throw { code: "not_found", message: `Todo ${id} not found` };
  todo.done = !todo.done;
  rebuildAndSync();
  console.error(`  ~ Toggled: "${todo.title}" → ${todo.done ? "done" : "not done"}`);
});

provider.onInvoke("edit", (params, path) => {
  const id = path.split("/").pop()!;
  const todo = todos.find((t) => t.id === id);
  if (!todo) throw { code: "not_found", message: `Todo ${id} not found` };
  todo.title = params.title as string;
  rebuildAndSync();
  console.error(`  ~ Edited: ${id} → "${todo.title}"`);
});

provider.onInvoke("delete", (_params, path) => {
  const id = path.split("/").pop()!;
  const removed = todos.find((t) => t.id === id);
  todos = todos.filter((t) => t.id !== id);
  rebuildAndSync();
  console.error(`  - Deleted: "${removed?.title}" (${id})`);
});

provider.onInvoke("clear_completed", () => {
  const count = todos.filter((t) => t.done).length;
  todos = todos.filter((t) => !t.done);
  rebuildAndSync();
  console.error(`  - Cleared ${count} completed todos`);
});

provider.onInvoke("complete_all", () => {
  let count = 0;
  for (const todo of todos) {
    if (!todo.done) { todo.done = true; count++; }
  }
  rebuildAndSync();
  console.error(`  ~ Completed ${count} todos`);
  return { completed: count };
});

// --- Start ---

provider.start().then(() => {
  console.error(`SLOP Todo provider running on ${SOCKET_PATH}`);
  console.error(`  ${todos.length} initial todos`);
  console.error(`  Connect with: bun run demo:consumer`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("\nShutting down...");
  await provider.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await provider.stop();
  process.exit(0);
});
