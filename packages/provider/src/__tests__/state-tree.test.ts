import { describe, test, expect } from "bun:test";
import { StateTree } from "../state-tree";
import type { SlopNode } from "@slop/types";

const sampleTree: SlopNode = {
  id: "root",
  type: "root",
  properties: { label: "App" },
  children: [
    {
      id: "todos",
      type: "collection",
      properties: { label: "Todos" },
      children: [
        { id: "t1", type: "item", properties: { title: "First", done: false } },
        { id: "t2", type: "item", properties: { title: "Second", done: true } },
      ],
    },
    {
      id: "stats",
      type: "status",
      properties: { total: 2, completed: 1 },
    },
  ],
};

describe("StateTree", () => {
  test("resolve root", () => {
    const tree = new StateTree(sampleTree);
    expect(tree.resolve("/")?.id).toBe("root");
    expect(tree.resolve("")?.id).toBe("root");
  });

  test("resolve nested path", () => {
    const tree = new StateTree(sampleTree);
    expect(tree.resolve("/todos")?.id).toBe("todos");
    expect(tree.resolve("/todos/t1")?.id).toBe("t1");
    expect(tree.resolve("/stats")?.id).toBe("stats");
  });

  test("resolve returns null for missing path", () => {
    const tree = new StateTree(sampleTree);
    expect(tree.resolve("/nonexistent")).toBeNull();
    expect(tree.resolve("/todos/t99")).toBeNull();
  });

  test("resolveAtDepth truncates", () => {
    const tree = new StateTree(sampleTree);
    const result = tree.resolveAtDepth("/", 1) as SlopNode;
    // Root should have children
    expect(result.children).toHaveLength(2);
    // But children's children should be stubs (no properties, no children)
    const todos = result.children![0];
    // todos at depth 0 from its perspective should be a stub
    expect(todos.meta?.total_children).toBe(2);
    expect((todos as any).properties).toBeUndefined();
  });

  test("resolveAtDepth -1 returns full tree", () => {
    const tree = new StateTree(sampleTree);
    const result = tree.resolveAtDepth("/", -1) as SlopNode;
    expect(result.children![0].children).toHaveLength(2);
    expect(result.children![0].children![0].properties?.title).toBe("First");
  });

  test("setTree computes diff and increments version", () => {
    const tree = new StateTree(sampleTree);
    expect(tree.getVersion()).toBe(0);

    const updated = structuredClone(sampleTree);
    updated.children![0].children![0].properties!.done = true;
    const ops = tree.setTree(updated);

    expect(ops.length).toBeGreaterThan(0);
    expect(tree.getVersion()).toBe(1);
    expect(tree.resolve("/todos/t1")?.properties?.done).toBe(true);
  });

  test("setTree with no changes returns empty ops", () => {
    const tree = new StateTree(sampleTree);
    const ops = tree.setTree(structuredClone(sampleTree));
    expect(ops).toEqual([]);
    expect(tree.getVersion()).toBe(0);
  });
});
