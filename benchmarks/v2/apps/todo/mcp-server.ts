/**
 * Stdio MCP server for the todo benchmark app. Spawned as a child process by
 * the MCP cell runner with env vars:
 * - BENCH_SCALE = s | m | l | xl    (required)
 * - BENCH_SEED  = integer           (required)
 *
 * Both are read at startup; the agent sees whatever the seed produced.
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TodoStore, type Priority } from "./store.ts";
import { seedTodo } from "./seed.ts";
import type { DataScale } from "../../runner/types.ts";

const scale = (process.env.BENCH_SCALE as DataScale | undefined) ?? "s";
const seed = Number(process.env.BENCH_SEED ?? 42);

const store = new TodoStore();
store.reset(seedTodo(scale, seed));

const server = new Server({ name: "todo-mcp", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_tasks",
      description: "List every task in the todo app",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "get_task",
      description: "Get a single task by id",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Task id" } },
        required: ["id"],
      },
    },
    {
      name: "mark_done",
      description: "Mark a task as done (no-op if already done)",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Task id" } },
        required: ["id"],
      },
    },
    {
      name: "reopen_task",
      description: "Mark a done task as not done (no-op if already undone)",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Task id" } },
        required: ["id"],
      },
    },
    {
      name: "set_priority",
      description: "Set a task's priority (low, medium, high)",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Task id" },
          priority: { type: "string", description: "low | medium | high" },
        },
        required: ["id", "priority"],
      },
    },
    {
      name: "set_tag",
      description: "Set a task's tag. Empty string clears it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Task id" },
          tag: { type: "string", description: "Tag name; empty string to clear" },
        },
        required: ["id", "tag"],
      },
    },
    {
      name: "edit_title",
      description: "Rename a task",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Task id" },
          title: { type: "string", description: "New title" },
        },
        required: ["id", "title"],
      },
    },
    {
      name: "delete_task",
      description: "Delete a task permanently",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Task id" } },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "list_tasks":
        return json(store.tasks);
      case "get_task": {
        const t = store.get(String(a.id));
        return t ? json(t) : err(`task ${a.id} not found`);
      }
      case "mark_done": {
        const t = store.get(String(a.id));
        if (!t) return err(`task ${a.id} not found`);
        store.setDone(t.id, true);
        return json({ id: t.id, done: true });
      }
      case "reopen_task": {
        const t = store.get(String(a.id));
        if (!t) return err(`task ${a.id} not found`);
        store.setDone(t.id, false);
        return json({ id: t.id, done: false });
      }
      case "set_priority": {
        const t = store.get(String(a.id));
        if (!t) return err(`task ${a.id} not found`);
        const p = String(a.priority);
        if (!["low", "medium", "high"].includes(p)) return err(`invalid priority ${p}`);
        store.setPriority(t.id, p as Priority);
        return json({ id: t.id, priority: p });
      }
      case "set_tag": {
        const t = store.get(String(a.id));
        if (!t) return err(`task ${a.id} not found`);
        const tag = String(a.tag ?? "");
        store.setTag(t.id, tag === "" ? null : tag);
        return json({ id: t.id, tag: tag === "" ? null : tag });
      }
      case "edit_title": {
        const t = store.get(String(a.id));
        if (!t) return err(`task ${a.id} not found`);
        store.editTitle(t.id, String(a.title));
        return json({ id: t.id });
      }
      case "delete_task": {
        const t = store.get(String(a.id));
        if (!t) return err(`task ${a.id} not found`);
        store.delete(t.id);
        return json({ deleted: t.id });
      }
      default:
        return err(`unknown tool ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

function json(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function err(msg: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
