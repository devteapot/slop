import { sharedState } from "@slop-ai/tanstack-start/server";

export interface Project {
  id: string;
  name: string;
  status: "active" | "archived";
  created: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
}

// sharedState ensures one copy across Vite module environments in dev
const state = sharedState("project-tracker", {
  projects: [
    { id: "p1", name: "SLOP Protocol", status: "active", created: "2026-01-15" },
    { id: "p2", name: "Website Redesign", status: "active", created: "2026-02-20" },
    { id: "p3", name: "Old Migration", status: "archived", created: "2025-11-01" },
  ] as Project[],
  tasks: [
    { id: "t1", projectId: "p1", title: "Write spec", done: true },
    { id: "t2", projectId: "p1", title: "Build SDK", done: false },
    { id: "t3", projectId: "p1", title: "Launch docs", done: false },
    { id: "t4", projectId: "p2", title: "Design mockups", done: true },
    { id: "t5", projectId: "p2", title: "Implement landing page", done: false },
  ] as Task[],
  nextId: 100,
});

export function getProjects(): Project[] {
  return state.projects;
}
export function getProject(id: string): Project | undefined {
  return state.projects.find((p) => p.id === id);
}
export function getTasksForProject(id: string): Task[] {
  return state.tasks.filter((t) => t.projectId === id);
}

export function addProject(name: string) {
  state.projects = [...state.projects, {
    id: `id-${state.nextId++}`,
    name,
    status: "active",
    created: new Date().toISOString().split("T")[0],
  }];
}

export function archiveProject(id: string) {
  state.projects = state.projects.map((project: Project) =>
    project.id === id ? { ...project, status: "archived" } : project,
  );
}

export function renameProject(id: string, name: string) {
  state.projects = state.projects.map((project: Project) =>
    project.id === id ? { ...project, name } : project,
  );
}

export function addTask(projectId: string, title: string) {
  state.tasks = [
    ...state.tasks,
    { id: `id-${state.nextId++}`, projectId, title, done: false },
  ];
}

export function toggleTask(id: string) {
  state.tasks = state.tasks.map((task: Task) =>
    task.id === id ? { ...task, done: !task.done } : task,
  );
}

export function deleteTask(id: string) {
  state.tasks = state.tasks.filter((t: Task) => t.id !== id);
}
