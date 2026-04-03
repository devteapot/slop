import { load, save, nextId, parseDate, today, computeSalience, type Task } from "./store";

// --- ANSI colors ---
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const STRIKETHROUGH = "\x1b[9m";

function checkbox(done: boolean): string {
  return done ? `${GREEN}[x]${RESET}` : `[ ]`;
}

function formatDue(task: Task): string {
  if (task.done && task.completed_at) {
    const ago = timeAgo(new Date(task.completed_at));
    return `${DIM}done: ${ago}${RESET}`;
  }
  if (!task.due) return "";

  const todayStr = today();
  const due = task.due;

  if (due < todayStr) {
    return `${RED}${BOLD}due: overdue!${RESET}`;
  }
  if (due === todayStr) {
    return `${YELLOW}due: today${RESET}`;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (due === tomorrowStr) {
    return `${CYAN}due: tomorrow${RESET}`;
  }

  return `${DIM}due: ${due}${RESET}`;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTags(tags: string[]): string {
  if (!tags.length) return "";
  return tags.map(t => `${MAGENTA}#${t}${RESET}`).join(" ");
}

function taskNumber(id: string): string {
  return id.replace("t-", "");
}

// --- Commands ---

export async function listTasks(opts: { all?: boolean; tag?: string }): Promise<void> {
  const tasks = await load();
  let filtered = tasks;

  if (opts.tag) {
    filtered = filtered.filter(t => t.tags.includes(opts.tag!));
  }

  if (!opts.all) {
    // Show pending tasks by default, plus recently completed
    filtered = filtered.filter(t => !t.done);
  }

  if (filtered.length === 0) {
    console.log(DIM + "No tasks found." + RESET);
    return;
  }

  // Sort: overdue first, then by due date, completed last
  filtered.sort((a, b) => {
    const sa = computeSalience(a).salience;
    const sb = computeSalience(b).salience;
    return sb - sa;
  });

  for (const t of filtered) {
    const num = taskNumber(t.id).padStart(3);
    const check = checkbox(t.done);
    const title = t.done ? `${DIM}${STRIKETHROUGH}${t.title}${RESET}` : t.title;
    const due = formatDue(t);
    const tags = formatTags(t.tags);
    const parts = [` ${num}. ${check} ${title}`];
    if (due) parts.push(due);
    if (tags) parts.push(tags);
    console.log(parts.join("    "));
  }
}

export async function addTask(title: string, opts: { due?: string; tag?: string }): Promise<void> {
  const tasks = await load();
  const id = nextId(tasks);
  const task: Task = {
    id,
    title,
    done: false,
    tags: opts.tag ? opts.tag.split(",").map(t => t.trim()) : [],
    notes: "",
    created: new Date().toISOString(),
  };
  if (opts.due) {
    task.due = parseDate(opts.due);
  }
  tasks.push(task);
  await save(tasks);
  console.log(`${GREEN}Created task #${taskNumber(id)}${RESET}`);
}

export async function doneTask(idArg: string): Promise<void> {
  const tasks = await load();
  const task = findTask(tasks, idArg);
  if (!task) return;

  task.done = true;
  task.completed_at = new Date().toISOString();
  await save(tasks);
  console.log(`${GREEN}Completed: ${task.title}${RESET}`);
}

export async function undoTask(idArg: string): Promise<void> {
  const tasks = await load();
  const task = findTask(tasks, idArg);
  if (!task) return;

  task.done = false;
  delete task.completed_at;
  await save(tasks);
  console.log(`Reopened: ${task.title}`);
}

export async function editTask(idArg: string, opts: { title?: string; due?: string; tag?: string }): Promise<void> {
  const tasks = await load();
  const task = findTask(tasks, idArg);
  if (!task) return;

  if (opts.title) task.title = opts.title;
  if (opts.due) task.due = parseDate(opts.due);
  if (opts.tag) task.tags = opts.tag.split(",").map(t => t.trim());
  await save(tasks);
  console.log(`${GREEN}Updated: ${task.title}${RESET}`);
}

export async function deleteTask(idArg: string): Promise<void> {
  const tasks = await load();
  const idx = findTaskIndex(tasks, idArg);
  if (idx < 0) return;

  const [removed] = tasks.splice(idx, 1);
  await save(tasks);
  console.log(`${RED}Deleted: ${removed.title}${RESET}`);
}

export async function showNotes(idArg: string, opts: { set?: string }): Promise<void> {
  const tasks = await load();
  const task = findTask(tasks, idArg);
  if (!task) return;

  if (opts.set !== undefined) {
    task.notes = opts.set;
    await save(tasks);
    console.log(`${GREEN}Notes updated for: ${task.title}${RESET}`);
    return;
  }

  if (!task.notes) {
    console.log(DIM + "No notes." + RESET);
  } else {
    console.log(`${BOLD}${task.title}${RESET}`);
    console.log(task.notes);
  }
}

export async function searchTasks(query: string): Promise<void> {
  const tasks = await load();
  const lower = query.toLowerCase();
  const matches = tasks.filter(t =>
    t.title.toLowerCase().includes(lower) ||
    t.tags.some(tag => tag.toLowerCase().includes(lower))
  );

  if (matches.length === 0) {
    console.log(DIM + `No tasks matching "${query}".` + RESET);
    return;
  }

  for (const t of matches) {
    const num = taskNumber(t.id).padStart(3);
    const check = checkbox(t.done);
    const tags = formatTags(t.tags);
    console.log(` ${num}. ${check} ${t.title}    ${tags}`);
  }
}

export async function exportTasks(format: string): Promise<void> {
  const tasks = await load();

  switch (format) {
    case "json":
      console.log(JSON.stringify({ tasks }, null, 2));
      break;
    case "csv": {
      console.log("id,title,done,due,tags,notes");
      for (const t of tasks) {
        const fields = [
          t.id,
          `"${t.title.replace(/"/g, '""')}"`,
          t.done ? "true" : "false",
          t.due ?? "",
          t.tags.join(";"),
          `"${t.notes.replace(/"/g, '""')}"`,
        ];
        console.log(fields.join(","));
      }
      break;
    }
    case "markdown": {
      console.log("# Tasks\n");
      const pending = tasks.filter(t => !t.done);
      const done = tasks.filter(t => t.done);
      if (pending.length) {
        console.log("## Pending\n");
        for (const t of pending) {
          const due = t.due ? ` (due: ${t.due})` : "";
          const tags = t.tags.length ? ` ${t.tags.map(x => `\`${x}\``).join(" ")}` : "";
          console.log(`- [ ] ${t.title}${due}${tags}`);
        }
        console.log();
      }
      if (done.length) {
        console.log("## Completed\n");
        for (const t of done) {
          const tags = t.tags.length ? ` ${t.tags.map(x => `\`${x}\``).join(" ")}` : "";
          console.log(`- [x] ${t.title}${tags}`);
        }
      }
      break;
    }
    default:
      console.error(`Unknown format: ${format}. Use: json, csv, markdown`);
      process.exit(1);
  }
}

// --- Helpers ---

function findTask(tasks: Task[], idArg: string): Task | undefined {
  const id = idArg.startsWith("t-") ? idArg : `t-${idArg}`;
  const task = tasks.find(t => t.id === id);
  if (!task) {
    console.error(`${RED}Task ${idArg} not found.${RESET}`);
  }
  return task;
}

function findTaskIndex(tasks: Task[], idArg: string): number {
  const id = idArg.startsWith("t-") ? idArg : `t-${idArg}`;
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) {
    console.error(`${RED}Task ${idArg} not found.${RESET}`);
  }
  return idx;
}
