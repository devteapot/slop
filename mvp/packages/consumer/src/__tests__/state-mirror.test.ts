import { describe, test, expect } from "bun:test";
import { StateMirror } from "../state-mirror";
import type { SlopNode, SnapshotMessage, PatchMessage } from "@slop/types";

const snapshot: SnapshotMessage = {
  type: "snapshot",
  id: "sub-1",
  version: 1,
  tree: {
    id: "root",
    type: "root",
    properties: { label: "App" },
    children: [
      {
        id: "todos",
        type: "collection",
        properties: { count: 2 },
        children: [
          { id: "t1", type: "item", properties: { title: "First", done: false } },
          { id: "t2", type: "item", properties: { title: "Second", done: true } },
        ],
      },
    ],
  },
};

describe("StateMirror", () => {
  test("initializes from snapshot", () => {
    const mirror = new StateMirror(snapshot);
    expect(mirror.getTree().id).toBe("root");
    expect(mirror.getVersion()).toBe(1);
  });

  test("applies property replace", () => {
    const mirror = new StateMirror(snapshot);
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        { op: "replace", path: "/children/todos/children/t1/properties/done", value: true },
      ],
    };
    mirror.applyPatch(patch);
    const t1 = mirror.getTree().children![0].children![0];
    expect(t1.properties?.done).toBe(true);
    expect(mirror.getVersion()).toBe(2);
  });

  test("applies property add", () => {
    const mirror = new StateMirror(snapshot);
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        { op: "add", path: "/children/todos/children/t1/properties/priority", value: "high" },
      ],
    };
    mirror.applyPatch(patch);
    const t1 = mirror.getTree().children![0].children![0];
    expect(t1.properties?.priority).toBe("high");
  });

  test("applies property remove", () => {
    const mirror = new StateMirror(snapshot);
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        { op: "remove", path: "/children/todos/children/t2/properties/done" },
      ],
    };
    mirror.applyPatch(patch);
    const t2 = mirror.getTree().children![0].children![1];
    expect(t2.properties?.done).toBeUndefined();
  });

  test("applies child add", () => {
    const mirror = new StateMirror(snapshot);
    const newChild: SlopNode = {
      id: "t3",
      type: "item",
      properties: { title: "Third", done: false },
    };
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        { op: "add", path: "/children/todos/children/t3", value: newChild },
      ],
    };
    mirror.applyPatch(patch);
    const todos = mirror.getTree().children![0];
    expect(todos.children).toHaveLength(3);
    expect(todos.children![2].id).toBe("t3");
  });

  test("applies child remove", () => {
    const mirror = new StateMirror(snapshot);
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        { op: "remove", path: "/children/todos/children/t1" },
      ],
    };
    mirror.applyPatch(patch);
    const todos = mirror.getTree().children![0];
    expect(todos.children).toHaveLength(1);
    expect(todos.children![0].id).toBe("t2");
  });

  test("applies affordances replace", () => {
    const mirror = new StateMirror(snapshot);
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        {
          op: "add",
          path: "/children/todos/children/t1/affordances",
          value: [{ action: "toggle" }, { action: "delete" }],
        },
      ],
    };
    mirror.applyPatch(patch);
    const t1 = mirror.getTree().children![0].children![0];
    expect(t1.affordances).toHaveLength(2);
    expect(t1.affordances![0].action).toBe("toggle");
  });

  test("applies multiple ops in sequence", () => {
    const mirror = new StateMirror(snapshot);
    const patch: PatchMessage = {
      type: "patch",
      subscription: "sub-1",
      version: 2,
      ops: [
        { op: "replace", path: "/children/todos/children/t1/properties/done", value: true },
        { op: "replace", path: "/children/todos/properties/count", value: 3 },
        {
          op: "add",
          path: "/children/todos/children/t3",
          value: { id: "t3", type: "item", properties: { title: "Third", done: false } },
        },
      ],
    };
    mirror.applyPatch(patch);
    const tree = mirror.getTree();
    expect(tree.children![0].properties?.count).toBe(3);
    expect(tree.children![0].children).toHaveLength(3);
    expect(tree.children![0].children![0].properties?.done).toBe(true);
  });
});
