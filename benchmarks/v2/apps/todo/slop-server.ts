import { SlopServer } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";
import type { NodeDescriptor } from "@slop-ai/core";
import type { TodoStore, Priority, Task } from "./store.ts";

export interface TodoSlopOpts {
  maxNodes?: number;
  maxDepth?: number;
  /**
   * optimized=true: windows the tasks collection to undone tasks + a rich
   * summary, assigns salience (undone > done, high > low), and pushes done
   * tasks behind the default window. off=false dumps every task inline.
   */
  optimized?: boolean;
}

export function createTodoSlopServer(store: TodoStore, opts?: TodoSlopOpts) {
  const slop = new SlopServer({
    id: "todo",
    name: "Todo",
    ...(opts?.maxNodes != null && { maxNodes: opts.maxNodes }),
    ...(opts?.maxDepth != null && { maxDepth: opts.maxDepth }),
  });

  const optimized = opts?.optimized ?? false;

  slop.register("overview", () => {
    const done = store.tasks.filter((t) => t.done).length;
    const undone = store.tasks.length - done;
    const bugs = store.tasks.filter((t) => t.tag === "bug").length;
    return {
      type: "context",
      props: {
        total: store.tasks.length,
        done,
        undone,
        bugs,
      },
      summary: `${store.tasks.length} tasks (${undone} undone, ${done} done, ${bugs} tagged bug)`,
    };
  });

  slop.register("tasks", () => {
    const all = store.tasks;
    if (optimized) {
      const done = all.filter((t) => t.done).length;
      const undone = all.length - done;
      return {
        type: "collection",
        props: { count: all.length },
        summary: `${all.length} tasks: ${undone} undone, ${done} done.`,
        children: Object.fromEntries(
          [...all]
            .map((task) => ({ task, salience: salienceFor(task) }))
            .sort((a, b) => b.salience - a.salience)
            .map(({ task, salience }) => [task.id, buildTaskNode(store, slop, task, salience)]),
        ),
      } satisfies NodeDescriptor;
    }
    return {
      type: "collection",
      props: { count: all.length },
      children: Object.fromEntries(all.map((task) => [task.id, buildTaskNode(store, slop, task)])),
    } satisfies NodeDescriptor;
  });

  return slop;
}

function salienceFor(t: Task): number {
  let score = t.done ? 0.1 : 0.5;
  if (!t.done && t.tag === "bug") score += 0.3;
  if (t.priority === "high") score += 0.2;
  return Math.min(1, score);
}

function buildTaskNode(
  store: TodoStore,
  slop: SlopServer,
  task: Task,
  salience?: number,
): NodeDescriptor {
  const actions: NonNullable<NodeDescriptor["actions"]> = {
    edit_title: {
      label: "Edit title",
      description: "Rename this task",
      params: { title: { type: "string", description: "New title" } },
      handler: async (params) => {
        store.editTitle(task.id, params.title as string);
        slop.refresh();
        return { id: task.id };
      },
    },
    set_priority: {
      label: "Set priority",
      description: "Set task priority (low, medium, high)",
      params: {
        priority: { type: "string", description: "low | medium | high" },
      },
      handler: async (params) => {
        store.setPriority(task.id, params.priority as Priority);
        slop.refresh();
        return { id: task.id };
      },
    },
    set_tag: {
      label: "Set tag",
      description: "Assign a tag to this task (empty string clears it)",
      params: { tag: { type: "string", description: "Tag name, or empty string to clear" } },
      handler: async (params) => {
        const t = String(params.tag ?? "");
        store.setTag(task.id, t === "" ? null : t);
        slop.refresh();
        return { id: task.id };
      },
    },
    delete: {
      label: "Delete task",
      description: "Delete this task permanently",
      params: {},
      handler: async () => {
        store.delete(task.id);
        slop.refresh();
        return { deleted: task.id };
      },
    },
  };

  // State-dependent affordance: only expose `mark_done` when not done, and
  // `reopen` when done — this is a key SLOP pitch so we exercise it.
  if (task.done) {
    actions.reopen = {
      label: "Reopen",
      description: "Mark this task as not done",
      params: {},
      handler: async () => {
        store.setDone(task.id, false);
        slop.refresh();
        return { id: task.id };
      },
    };
  } else {
    actions.mark_done = {
      label: "Mark done",
      description: "Mark this task as done",
      params: {},
      handler: async () => {
        store.setDone(task.id, true);
        slop.refresh();
        return { id: task.id };
      },
    };
  }

  const node: NodeDescriptor = {
    type: "task",
    props: {
      title: task.title,
      done: task.done,
      priority: task.priority,
      tag: task.tag ?? "",
    },
    actions,
  };
  if (salience !== undefined) {
    node.meta = { salience };
  }
  return node;
}

export function startTodoSlopServer(store: TodoStore, port: number, opts?: TodoSlopOpts) {
  const slop = createTodoSlopServer(store, opts);
  const handler = bunHandler(slop, { path: "/slop" });
  const server = Bun.serve({
    port,
    fetch(req, srv) {
      const resp = handler.fetch(req, srv);
      if (resp) return resp;
      return new Response("SLOP Todo benchmark server", { status: 200 });
    },
    websocket: handler.websocket,
  });
  return { server, slop };
}
