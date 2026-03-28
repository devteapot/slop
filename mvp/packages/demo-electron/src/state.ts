export interface Task {
  id: string;
  title: string;
  done: boolean;
  pomodoros: number;
  created: string;
}

export interface PomodoroState {
  status: "idle" | "running" | "break";
  remaining: number; // seconds
  taskId: string | null;
}

export interface AppState {
  tasks: Task[];
  pomodoro: PomodoroState;
  workDuration: number;   // seconds
  breakDuration: number;  // seconds
}

let nextId = 4;

export function createState(): AppState {
  return {
    tasks: [
      { id: "task-1", title: "Review pull requests", done: false, pomodoros: 2, created: new Date().toISOString() },
      { id: "task-2", title: "Write documentation", done: false, pomodoros: 0, created: new Date().toISOString() },
      { id: "task-3", title: "Fix login bug", done: true, pomodoros: 1, created: new Date().toISOString() },
    ],
    pomodoro: { status: "idle", remaining: 25 * 60, taskId: null },
    workDuration: 25 * 60,
    breakDuration: 5 * 60,
  };
}

export function addTask(state: AppState, title: string): string {
  const task: Task = {
    id: `task-${nextId++}`,
    title,
    done: false,
    pomodoros: 0,
    created: new Date().toISOString(),
  };
  state.tasks.push(task);
  return `Added task "${title}"`;
}

export function toggleTask(state: AppState, taskId: string): string {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw { code: "not_found", message: `Task ${taskId} not found` };
  task.done = !task.done;
  return `${task.done ? "Completed" : "Reopened"} "${task.title}"`;
}

export function editTask(state: AppState, taskId: string, title: string): string {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw { code: "not_found", message: `Task ${taskId} not found` };
  task.title = title;
  return `Renamed task to "${title}"`;
}

export function deleteTask(state: AppState, taskId: string): string {
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) throw { code: "not_found", message: `Task ${taskId} not found` };
  const [task] = state.tasks.splice(idx, 1);
  if (state.pomodoro.taskId === taskId) {
    state.pomodoro.status = "idle";
    state.pomodoro.taskId = null;
    state.pomodoro.remaining = state.workDuration;
  }
  return `Deleted "${task.title}"`;
}

export function startPomodoro(state: AppState, taskId: string): string {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw { code: "not_found", message: `Task ${taskId} not found` };
  state.pomodoro = {
    status: "running",
    remaining: state.workDuration,
    taskId,
  };
  return `Started pomodoro for "${task.title}"`;
}

export function stopPomodoro(state: AppState): string {
  const task = state.pomodoro.taskId
    ? state.tasks.find(t => t.id === state.pomodoro.taskId)
    : null;
  state.pomodoro = { status: "idle", remaining: state.workDuration, taskId: null };
  return task ? `Stopped pomodoro for "${task.title}"` : "Stopped pomodoro";
}

export function tickPomodoro(state: AppState): { finished: boolean; message?: string } {
  if (state.pomodoro.status === "idle") return { finished: false };

  state.pomodoro.remaining--;

  if (state.pomodoro.remaining <= 0) {
    if (state.pomodoro.status === "running") {
      // Work session done → start break
      const task = state.tasks.find(t => t.id === state.pomodoro.taskId);
      if (task) task.pomodoros++;
      state.pomodoro.status = "break";
      state.pomodoro.remaining = state.breakDuration;
      return { finished: true, message: `Pomodoro complete! ${task?.title ?? ""}. Break time.` };
    } else {
      // Break done → idle
      state.pomodoro = { status: "idle", remaining: state.workDuration, taskId: null };
      return { finished: true, message: "Break over! Ready for the next session." };
    }
  }

  return { finished: false };
}
