import { SlopServer } from "@slop-ai/server";
import { listenStdio } from "@slop-ai/server/stdio";
import { load, save, nextId, parseDate, today, computeSalience, sortBySalience, getFilePath, type Task } from "./store";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const WINDOW_SIZE = 25;
const DISCOVERY_DIR = join(homedir(), ".slop", "providers");
const DISCOVERY_FILE = join(DISCOVERY_DIR, "tsk.json");

export async function startSlopMode(): Promise<void> {
  let tasks = await load();

  const slop = new SlopServer({ id: "tsk", name: "tsk" });

  // --- Helper: reload tasks from disk ---
  async function reloadAndRefresh() {
    tasks = await load();
    slop.refresh();
  }

  // --- User context node ---
  slop.register("user", () => {
    const totalDone = tasks.filter(t => t.done).length;
    return {
      type: "context",
      props: {
        file: getFilePath(),
        total_tasks: tasks.length,
        total_done: totalDone,
      },
    };
  });

  // --- Tasks collection (dynamic) ---
  slop.register("tasks", () => {
    const pending = tasks.filter(t => !t.done);
    const todayStr = today();
    const overdue = pending.filter(t => t.due && t.due < todayStr);
    const sorted = sortBySalience(tasks);
    const windowed = sorted.slice(0, WINDOW_SIZE);

    return {
      type: "collection",
      props: {
        count: tasks.length,
        pending: pending.length,
        overdue: overdue.length,
      },
      summary: `${tasks.length} tasks: ${pending.length} pending, ${tasks.length - pending.length} done, ${overdue.length} overdue`,
      window: {
        items: windowed.map(t => buildTaskItem(t)),
        total: tasks.length,
        offset: 0,
      },
      actions: {
        add: {
          handler: async (params) => {
            const title = params.title as string;
            const id = nextId(tasks);
            const task: Task = {
              id,
              title,
              done: false,
              tags: params.tags ? (params.tags as string).split(",").map(s => s.trim()) : [],
              notes: "",
              created: new Date().toISOString(),
            };
            if (params.due) {
              task.due = parseDate(params.due as string);
            }
            tasks.push(task);
            await save(tasks);
            return { id, title };
          },
          label: "Add task",
          params: {
            title: "string",
            due: { type: "string", description: "ISO date or relative: 'today', 'tomorrow', 'next monday'" },
            tags: { type: "string", description: "Comma-separated tags" },
          },
          estimate: "instant",
        },
        clear_done: {
          handler: async () => {
            const before = tasks.length;
            tasks = tasks.filter(t => !t.done);
            await save(tasks);
            return { removed: before - tasks.length };
          },
          label: "Clear completed",
          description: "Remove all completed tasks",
          dangerous: true,
          estimate: "instant",
        },
        search: {
          handler: async (params) => {
            const query = (params.query as string ?? "").toLowerCase();
            const matches = tasks.filter(t =>
              t.title.toLowerCase().includes(query) ||
              t.tags.some(tag => tag.toLowerCase().includes(query))
            );
            return {
              results: matches.map(t => ({
                id: t.id, title: t.title, done: t.done, due: t.due, tags: t.tags,
              })),
            };
          },
          label: "Search tasks",
          description: "Search tasks by title or tag",
          params: {
            query: { type: "string", description: "Search term (matches title and tags)" },
          },
          idempotent: true,
          estimate: "instant",
        },
        export: {
          handler: async (params) => {
            const format = (params.format as string) ?? "json";
            // Simulate async action
            let content: string;
            switch (format) {
              case "csv": {
                const lines = ["id,title,done,due,tags"];
                for (const t of tasks) {
                  lines.push(`${t.id},"${t.title}",${t.done},${t.due ?? ""},${t.tags.join(";")}`);
                }
                content = lines.join("\n");
                break;
              }
              case "markdown": {
                const lines = ["# Tasks\n"];
                for (const t of tasks) {
                  const check = t.done ? "[x]" : "[ ]";
                  lines.push(`- ${check} ${t.title}`);
                }
                content = lines.join("\n");
                break;
              }
              default:
                content = JSON.stringify({ tasks }, null, 2);
            }
            return { format, content, count: tasks.length };
          },
          label: "Export tasks",
          description: "Export tasks to a file",
          params: {
            format: { type: "string", enum: ["json", "csv", "markdown"] },
          },
          estimate: "slow",
        },
      },
    };
  });

  // --- Tags collection (dynamic) ---
  slop.register("tags", () => {
    const tagCounts = new Map<string, number>();
    for (const t of tasks) {
      for (const tag of t.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const tagList = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
    const summaryParts = tagList.map(([name, count]) => `${name} (${count})`);

    return {
      type: "collection",
      props: { count: tagList.length },
      summary: `${tagList.length} tags: ${summaryParts.join(", ")}`,
      items: tagList.map(([name, count]) => ({
        id: name,
        props: { name, count },
      })),
      actions: {
        rename: {
          handler: async (params) => {
            const oldName = params.old as string;
            const newName = params.new as string;
            for (const t of tasks) {
              const idx = t.tags.indexOf(oldName);
              if (idx >= 0) t.tags[idx] = newName;
            }
            await save(tasks);
            return { old: oldName, new: newName };
          },
          label: "Rename tag",
          params: {
            old: "string",
            new: "string",
          },
          estimate: "instant",
        },
      },
    };
  });

  // --- Discovery: write provider descriptor ---
  writeDiscovery(tasks);

  // --- Cleanup on exit ---
  const cleanup = () => {
    try { rmSync(DISCOVERY_FILE); } catch {}
  };
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);

  // --- Start stdio transport ---
  listenStdio(slop);

  // --- Watch for file changes ---
  try {
    const watcher = Bun.file(getFilePath());
    // Use fs.watch for file change detection
    const { watch } = await import("node:fs");
    const fsWatcher = watch(getFilePath(), async () => {
      tasks = await load();
      slop.refresh();
      writeDiscovery(tasks);
    });
    process.on("exit", () => fsWatcher.close());
  } catch {
    // File watching is optional; ignore errors
  }
}

// --- Build an item descriptor for a task ---

function buildTaskItem(task: Task): {
  id: string;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
  actions: Record<string, any>;
} {
  const { salience, urgency, reason } = computeSalience(task);
  const meta: Record<string, unknown> = { salience };
  if (urgency) meta.urgency = urgency;
  if (reason) meta.reason = reason;

  // Content ref for notes
  const props: Record<string, unknown> = {
    title: task.title,
    done: task.done,
  };
  if (task.due) props.due = task.due;
  if (task.tags.length) props.tags = task.tags;
  if (task.done && task.completed_at) props.completed_at = task.completed_at;

  // Content reference as a property
  const hasNotes = task.notes && task.notes.length > 0;
  const noteLines = hasNotes ? task.notes.split("\n").length : 0;
  const contentRef: Record<string, unknown> = {
    type: "text",
    mime: "text/plain",
    summary: hasNotes ? `${noteLines} line${noteLines === 1 ? "" : "s"} of notes` : "No notes",
  };
  if (hasNotes) {
    contentRef.size = task.notes.length;
    contentRef.preview = task.notes.length > 100 ? task.notes.slice(0, 97) + "..." : task.notes;
  }
  props.content_ref = contentRef;

  // Actions differ for pending vs completed tasks
  const actions: Record<string, any> = {};

  if (task.done) {
    actions.undo = {
      handler: async () => {
        task.done = false;
        delete task.completed_at;
        await save(await load().then(all => {
          const t = all.find(x => x.id === task.id);
          if (t) { t.done = false; delete t.completed_at; }
          return all;
        }));
      },
      label: "Mark incomplete",
      estimate: "instant" as const,
    };
  } else {
    actions.done = {
      handler: async () => {
        const all = await load();
        const t = all.find(x => x.id === task.id);
        if (t) {
          t.done = true;
          t.completed_at = new Date().toISOString();
          await save(all);
        }
      },
      label: "Complete task",
      estimate: "instant" as const,
    };
    actions.edit = {
      handler: async (params: Record<string, unknown>) => {
        const all = await load();
        const t = all.find(x => x.id === task.id);
        if (t) {
          if (params.title) t.title = params.title as string;
          if (params.due) t.due = parseDate(params.due as string);
          if (params.tags) t.tags = (params.tags as string).split(",").map(s => s.trim());
          await save(all);
        }
      },
      label: "Edit task",
      params: {
        title: "string",
        due: "string",
        tags: "string",
      },
      estimate: "instant" as const,
    };
  }

  actions.delete = {
    handler: async () => {
      const all = await load();
      const idx = all.findIndex(x => x.id === task.id);
      if (idx >= 0) {
        all.splice(idx, 1);
        await save(all);
      }
    },
    label: "Delete task",
    dangerous: true,
    estimate: "instant" as const,
  };

  actions.read_notes = {
    handler: async () => {
      const all = await load();
      const t = all.find(x => x.id === task.id);
      return { content: t?.notes ?? "" };
    },
    label: "Read full notes",
    description: "Fetch the complete notes for this task",
    idempotent: true,
    estimate: "instant" as const,
  };

  actions.write_notes = {
    handler: async (params: Record<string, unknown>) => {
      const all = await load();
      const t = all.find(x => x.id === task.id);
      if (t) {
        t.notes = params.content as string;
        await save(all);
      }
    },
    label: "Write notes",
    params: {
      content: "string",
    },
    estimate: "instant" as const,
  };

  return { id: task.id, props, meta, actions };
}

// --- Discovery file ---

function writeDiscovery(tasks: Task[]) {
  const pending = tasks.filter(t => !t.done);
  const todayStr = today();
  const overdue = pending.filter(t => t.due && t.due < todayStr);

  const descriptor = {
    id: "tsk",
    name: "tsk",
    version: "0.1.0",
    slop_version: "0.1",
    transport: { type: "stdio", command: ["tsk", "--slop"] },
    pid: process.pid,
    capabilities: ["state", "patches", "affordances", "attention"],
    description: `Task manager with ${tasks.length} tasks (${pending.length} pending, ${overdue.length} overdue)`,
  };

  try {
    mkdirSync(DISCOVERY_DIR, { recursive: true });
    Bun.write(DISCOVERY_FILE, JSON.stringify(descriptor, null, 2));
  } catch {}
}
