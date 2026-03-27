import { describe, test, expect } from "bun:test";
import { diffNodes } from "../diff";
import type { SlopNode } from "@slop/types";

describe("diffNodes", () => {
  test("returns empty ops for identical trees", () => {
    const node: SlopNode = {
      id: "root",
      type: "root",
      properties: { label: "test" },
    };
    expect(diffNodes(node, node)).toEqual([]);
  });

  test("detects property changes", () => {
    const old: SlopNode = { id: "n", type: "item", properties: { title: "A", done: false } };
    const nw: SlopNode = { id: "n", type: "item", properties: { title: "B", done: false } };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "replace", path: "/properties/title", value: "B" },
    ]);
  });

  test("detects property additions", () => {
    const old: SlopNode = { id: "n", type: "item", properties: { title: "A" } };
    const nw: SlopNode = { id: "n", type: "item", properties: { title: "A", done: true } };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "add", path: "/properties/done", value: true },
    ]);
  });

  test("detects property removals", () => {
    const old: SlopNode = { id: "n", type: "item", properties: { title: "A", done: true } };
    const nw: SlopNode = { id: "n", type: "item", properties: { title: "A" } };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "remove", path: "/properties/done" },
    ]);
  });

  test("detects child additions", () => {
    const old: SlopNode = { id: "root", type: "root", children: [] };
    const child: SlopNode = { id: "c1", type: "item", properties: { title: "new" } };
    const nw: SlopNode = { id: "root", type: "root", children: [child] };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "add", path: "/children/c1", value: child },
    ]);
  });

  test("detects child removals", () => {
    const child: SlopNode = { id: "c1", type: "item", properties: { title: "gone" } };
    const old: SlopNode = { id: "root", type: "root", children: [child] };
    const nw: SlopNode = { id: "root", type: "root", children: [] };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "remove", path: "/children/c1" },
    ]);
  });

  test("recursively diffs shared children", () => {
    const old: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "c1", type: "item", properties: { done: false } }],
    };
    const nw: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "c1", type: "item", properties: { done: true } }],
    };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "replace", path: "/children/c1/properties/done", value: true },
    ]);
  });

  test("detects affordance changes", () => {
    const old: SlopNode = {
      id: "n", type: "item",
      affordances: [{ action: "open" }],
    };
    const nw: SlopNode = {
      id: "n", type: "item",
      affordances: [{ action: "open" }, { action: "delete" }],
    };
    const ops = diffNodes(old, nw);
    expect(ops).toEqual([
      { op: "replace", path: "/affordances", value: nw.affordances },
    ]);
  });

  test("handles multiple simultaneous changes", () => {
    const old: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "a", type: "item", properties: { v: 1 } },
        { id: "b", type: "item", properties: { v: 2 } },
      ],
    };
    const nw: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "a", type: "item", properties: { v: 10 } },
        // b removed
        { id: "c", type: "item", properties: { v: 3 } }, // c added
      ],
    };
    const ops = diffNodes(old, nw);
    expect(ops).toContainEqual({ op: "remove", path: "/children/b" });
    expect(ops).toContainEqual({ op: "add", path: "/children/c", value: nw.children![1] });
    expect(ops).toContainEqual({ op: "replace", path: "/children/a/properties/v", value: 10 });
  });
});
