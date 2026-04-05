import { describe, test, expect } from "bun:test";
import { StateMirror } from "../src/state-mirror";
import type { SlopNode, SnapshotMessage, PatchMessage } from "../src/types";

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
    mirror.applyPatch({
      type: "patch", subscription: "sub-1", version: 2,
      ops: [{ op: "replace", path: "/todos/t1/properties/done", value: true }],
    });
    expect(mirror.getTree().children![0].children![0].properties?.done).toBe(true);
    expect(mirror.getVersion()).toBe(2);
  });

  test("applies child add", () => {
    const mirror = new StateMirror(snapshot);
    mirror.applyPatch({
      type: "patch", subscription: "sub-1", version: 2,
      ops: [{ op: "add", path: "/todos/t3", value: { id: "t3", type: "item", properties: { title: "Third" } } }],
    });
    expect(mirror.getTree().children![0].children).toHaveLength(3);
  });

  test("applies child remove", () => {
    const mirror = new StateMirror(snapshot);
    mirror.applyPatch({
      type: "patch", subscription: "sub-1", version: 2,
      ops: [{ op: "remove", path: "/todos/t1" }],
    });
    expect(mirror.getTree().children![0].children).toHaveLength(1);
    expect(mirror.getTree().children![0].children![0].id).toBe("t2");
  });

  test("applies multiple ops in sequence", () => {
    const mirror = new StateMirror(snapshot);
    mirror.applyPatch({
      type: "patch", subscription: "sub-1", version: 2,
      ops: [
        { op: "replace", path: "/todos/t1/properties/done", value: true },
        { op: "replace", path: "/todos/properties/count", value: 3 },
        { op: "add", path: "/todos/t3", value: { id: "t3", type: "item", properties: { title: "Third" } } },
      ],
    });
    const tree = mirror.getTree();
    expect(tree.children![0].properties?.count).toBe(3);
    expect(tree.children![0].children).toHaveLength(3);
    expect(tree.children![0].children![0].properties?.done).toBe(true);
  });
});
