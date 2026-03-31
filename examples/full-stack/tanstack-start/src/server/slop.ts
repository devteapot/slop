import { createMiddleware } from "@tanstack/react-start";
import { createSlopServer, createSlopRefreshFn } from "@slop-ai/tanstack-start/server";
import {
  getProjects,
  getTasksForProject,
  addProject,
  archiveProject,
  renameProject,
  addTask,
  toggleTask,
  deleteTask,
} from "./state";

export const slop = createSlopServer({
  id: "project-tracker",
  name: "Project Tracker",
});

/** Middleware that auto-refreshes the SLOP tree after any server function */
export const slopMiddleware = createMiddleware().server(createSlopRefreshFn(slop));

slop.register("projects", () => ({
  type: "collection",
  props: {
    total: getProjects().length,
    active: getProjects().filter((p) => p.status === "active").length,
  },
  actions: {
    create_project: {
      params: { name: "string" },
      handler: (params) => addProject(params.name as string),
    },
  },
  items: getProjects().map((p) => {
    const projectTasks = getTasksForProject(p.id);
    return {
      id: p.id,
      props: {
        name: p.name,
        status: p.status,
        taskCount: projectTasks.length,
        done: projectTasks.filter((t) => t.done).length,
      },
      actions: {
        archive: () => archiveProject(p.id),
        rename: {
          params: { name: "string" },
          handler: (params) => renameProject(p.id, params.name as string),
        },
        add_task: {
          params: { title: "string" },
          handler: (params) => addTask(p.id, params.title as string),
        },
      },
      children: {
        tasks: {
          type: "collection",
          props: { count: projectTasks.length },
          items: projectTasks.map((t) => ({
            id: t.id,
            props: { title: t.title, done: t.done },
            actions: {
              toggle: () => toggleTask(t.id),
              delete: { handler: () => deleteTask(t.id), dangerous: true },
            },
          })),
        },
      },
    };
  }),
}));
