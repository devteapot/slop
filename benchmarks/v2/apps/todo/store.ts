export type Priority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  tag: string | null;
  createdAt: number;
}

export class TodoStore {
  tasks: Task[] = [];

  reset(tasks: Task[]) {
    this.tasks = tasks.map((t) => ({ ...t }));
  }

  get(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  mustGet(id: string): Task {
    const t = this.get(id);
    if (!t) throw new Error(`Task ${id} not found`);
    return t;
  }

  add(task: Omit<Task, "id" | "createdAt"> & { id?: string }): Task {
    const id = task.id ?? `task-${this.tasks.length + 1}`;
    const t: Task = { id, createdAt: Date.now(), ...task };
    this.tasks.push(t);
    return t;
  }

  toggleDone(id: string): Task {
    const t = this.mustGet(id);
    t.done = !t.done;
    return t;
  }

  setDone(id: string, done: boolean): Task {
    const t = this.mustGet(id);
    t.done = done;
    return t;
  }

  setPriority(id: string, priority: Priority): Task {
    const t = this.mustGet(id);
    t.priority = priority;
    return t;
  }

  setTag(id: string, tag: string | null): Task {
    const t = this.mustGet(id);
    t.tag = tag;
    return t;
  }

  editTitle(id: string, title: string): Task {
    const t = this.mustGet(id);
    t.title = title;
    return t;
  }

  delete(id: string): void {
    this.tasks = this.tasks.filter((t) => t.id !== id);
  }
}
