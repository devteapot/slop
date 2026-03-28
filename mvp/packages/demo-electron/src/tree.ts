import type { SlopNode } from "@slop/types";
import type { AppState } from "./state";

export function buildTree(state: AppState): SlopNode {
  const pending = state.tasks.filter(t => !t.done);
  const done = state.tasks.filter(t => t.done);

  return {
    id: "root",
    type: "root",
    properties: { label: "Pomodoro Tracker" },
    affordances: [
      {
        action: "add_task",
        label: "Add Task",
        description: "Add a new task to the list",
        params: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
          },
          required: ["title"],
        },
      },
    ],
    children: [
      // Timer
      {
        id: "timer",
        type: "timer",
        properties: {
          label: "Pomodoro Timer",
          status: state.pomodoro.status,
          remaining: formatTime(state.pomodoro.remaining),
          remaining_seconds: state.pomodoro.remaining,
          current_task: state.pomodoro.taskId,
        },
        affordances: state.pomodoro.status !== "idle"
          ? [{ action: "stop", label: "Stop Timer" }]
          : [],
        meta: {
          salience: state.pomodoro.status === "running" ? 1.0 : 0.3,
          urgency: state.pomodoro.status === "running" && state.pomodoro.remaining < 60
            ? "high" : "none",
        },
      },
      // Pending tasks
      {
        id: "pending",
        type: "collection",
        properties: {
          label: "Pending Tasks",
          count: pending.length,
        },
        children: pending.map(task => taskToNode(task, state)),
      },
      // Completed tasks
      {
        id: "completed",
        type: "collection",
        properties: {
          label: "Completed Tasks",
          count: done.length,
        },
        children: done.map(task => taskToNode(task, state)),
        meta: { salience: 0.2 },
      },
      // Stats
      {
        id: "stats",
        type: "status",
        properties: {
          total_tasks: state.tasks.length,
          pending: pending.length,
          completed: done.length,
          total_pomodoros: state.tasks.reduce((sum, t) => sum + t.pomodoros, 0),
        },
        meta: {
          summary: `${pending.length} pending, ${done.length} done, ${state.tasks.reduce((sum, t) => sum + t.pomodoros, 0)} pomodoros`,
        },
      },
    ],
  };
}

function taskToNode(task: AppState["tasks"][0], state: AppState): SlopNode {
  const isActive = state.pomodoro.taskId === task.id && state.pomodoro.status !== "idle";
  const affordances: SlopNode["affordances"] = [
    {
      action: "toggle",
      label: task.done ? "Reopen Task" : "Complete Task",
    },
    {
      action: "edit",
      label: "Edit Task",
      params: {
        type: "object",
        properties: {
          title: { type: "string", description: "New title" },
        },
        required: ["title"],
      },
    },
    {
      action: "delete",
      label: "Delete Task",
      dangerous: true,
    },
  ];

  if (!task.done && !isActive) {
    affordances.push({
      action: "start_pomodoro",
      label: "Start Pomodoro",
      description: "Start a 25-minute focus session on this task",
    });
  }

  return {
    id: task.id,
    type: "item",
    properties: {
      title: task.title,
      done: task.done,
      pomodoros: task.pomodoros,
      created: task.created,
      ...(isActive ? { active_pomodoro: true } : {}),
    },
    affordances,
    meta: {
      salience: isActive ? 0.9 : task.done ? 0.2 : 0.6,
    },
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
