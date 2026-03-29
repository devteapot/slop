import { describe, test, expect } from "bun:test";
import { affordancesToTools, encodeTool, decodeTool, formatTree } from "../src/tools";
import type { SlopNode } from "../src/types";

describe("encodeTool / decodeTool", () => {
  test("encodes root action", () => {
    expect(encodeTool("/", "create")).toBe("invoke__create");
  });

  test("encodes nested path", () => {
    expect(encodeTool("/todos/todo-1", "toggle")).toBe("invoke__todos__todo-1__toggle");
  });

  test("decodes root action", () => {
    expect(decodeTool("invoke__create")).toEqual({ path: "/", action: "create" });
  });

  test("decodes nested path", () => {
    expect(decodeTool("invoke__todos__todo-1__toggle")).toEqual({ path: "/todos/todo-1", action: "toggle" });
  });

  test("roundtrips", () => {
    const original = { path: "/inbox/messages", action: "archive" };
    const encoded = encodeTool(original.path, original.action);
    expect(decodeTool(encoded)).toEqual(original);
  });
});

describe("affordancesToTools", () => {
  test("extracts tools from tree", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      affordances: [{ action: "create", label: "Create" }],
      children: [{
        id: "item-1", type: "item",
        affordances: [{ action: "delete", dangerous: true }],
      }],
    };
    const tools = affordancesToTools(tree);
    expect(tools).toHaveLength(2);
    expect(tools[0].function.name).toBe("invoke__create");
    expect(tools[1].function.name).toBe("invoke__item-1__delete");
    expect(tools[1].function.description).toContain("DANGEROUS");
  });
});

describe("formatTree", () => {
  test("formats a tree", () => {
    const tree: SlopNode = {
      id: "root", type: "root", properties: { label: "App" },
      children: [{ id: "notes", type: "collection", properties: { count: 3 } }],
    };
    const output = formatTree(tree);
    expect(output).toContain("[root] App");
    expect(output).toContain("[collection] notes");
    expect(output).toContain("count=3");
  });
});
