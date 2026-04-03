import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

// --- Data model ---

export interface Task {
  id: string;
  title: string;
  done: boolean;
  due?: string;
  tags: string[];
  notes: string;
  created: string;
  completed_at?: string;
}

export interface TaskStore {
  tasks: Task[];
}

// --- File path resolution ---

let filePath: string | undefined;

export function setFilePath(path: string): void {
  filePath = path;
}

export function getFilePath(): string {
  if (filePath) return filePath;
  const envPath = process.env.TSK_FILE;
  if (envPath) return envPath;
  return join(homedir(), ".tsk", "tasks.json");
}

// --- Load / Save ---

export async function load(): Promise<Task[]> {
  const path = getFilePath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    // If no file exists, try copying seed data
    const seedPath = join(import.meta.dir, "..", "seed.json");
    const seedFile = Bun.file(seedPath);
    if (await seedFile.exists()) {
      const dir = path.substring(0, path.lastIndexOf("/"));
      mkdirSync(dir, { recursive: true });
      const seedData = await seedFile.json();
      await Bun.write(path, JSON.stringify(seedData, null, 2));
      return seedData.tasks;
    }
    return [];
  }
  const data: TaskStore = await file.json();
  return data.tasks;
}

export async function save(tasks: Task[]): Promise<void> {
  const path = getFilePath();
  const dir = path.substring(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  await Bun.write(path, JSON.stringify({ tasks }, null, 2));
}

// --- Helpers ---

let nextIdCounter = 0;

export function nextId(tasks: Task[]): string {
  // Find the highest numeric ID suffix
  let max = 0;
  for (const t of tasks) {
    const num = parseInt(t.id.replace("t-", ""), 10);
    if (num > max) max = num;
  }
  return `t-${max + 1}`;
}

/** Parse a date string: 'today', 'tomorrow', 'next monday', or ISO date */
export function parseDate(input: string): string {
  const lower = input.toLowerCase().trim();
  const now = new Date();

  if (lower === "today") {
    return toISODate(now);
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }
  if (lower.startsWith("next ")) {
    const dayName = lower.slice(5);
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const targetDay = days.indexOf(dayName);
    if (targetDay >= 0) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return toISODate(d);
    }
  }
  // Assume ISO date
  return input;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get today's date as ISO string */
export function today(): string {
  return toISODate(new Date());
}

/** Compute salience and urgency for a task */
export function computeSalience(task: Task): { salience: number; urgency?: "high" | "medium" | "low"; reason?: string } {
  if (task.done) {
    return { salience: 0.2 };
  }

  if (!task.due) {
    return { salience: 0.4 };
  }

  const now = new Date();
  const todayStr = toISODate(now);
  const due = task.due;

  if (due < todayStr) {
    const daysOverdue = Math.ceil((now.getTime() - new Date(due).getTime()) / (1000 * 60 * 60 * 24));
    return { salience: 1.0, urgency: "high", reason: `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue` };
  }

  if (due === todayStr) {
    return { salience: 0.9, urgency: "medium", reason: "due today" };
  }

  // Check if due within this week (7 days)
  const dueDate = new Date(due);
  const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 7) {
    return { salience: 0.7, urgency: "low" };
  }

  return { salience: 0.5 };
}

/** Sort tasks by salience (highest first) */
export function sortBySalience(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const sa = computeSalience(a).salience;
    const sb = computeSalience(b).salience;
    return sb - sa;
  });
}
