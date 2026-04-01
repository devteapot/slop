import { describe, test, expect } from "bun:test";
import { affordancesToTools, formatTree } from "../src/tools";
import type { SlopNode } from "../src/types";

describe("affordancesToTools", () => {
  test("returns ToolSet with short nodeId__action names", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      affordances: [{ action: "create", label: "Create" }],
      children: [{
        id: "item-1", type: "item",
        affordances: [{ action: "delete", dangerous: true }],
      }],
    };
    const toolSet = affordancesToTools(tree);
    expect(toolSet.tools).toHaveLength(2);
    expect(toolSet.tools[0].function.name).toBe("root__create");
    expect(toolSet.tools[1].function.name).toBe("item_1__delete");
    expect(toolSet.tools[1].function.description).toContain("DANGEROUS");
  });

  test("resolve maps tool name back to path + action", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "inbox", type: "view",
        children: [{
          id: "msg-1", type: "item",
          affordances: [{ action: "archive", label: "Archive message" }],
        }],
      }],
    };
    const toolSet = affordancesToTools(tree);
    expect(toolSet.tools[0].function.description).toContain("/inbox/msg-1");
    expect(toolSet.resolve("msg_1__archive")).toEqual({ path: "/inbox/msg-1", action: "archive" });
  });

  test("disambiguates colliding node IDs with parent prefix", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "board-1", type: "view", children: [
          { id: "backlog", type: "collection", affordances: [{ action: "reorder" }] },
        ]},
        { id: "board-2", type: "view", children: [
          { id: "backlog", type: "collection", affordances: [{ action: "reorder" }] },
        ]},
      ],
    };
    const toolSet = affordancesToTools(tree);
    expect(toolSet.tools).toHaveLength(2);
    const names = toolSet.tools.map(t => t.function.name);
    expect(names[0]).not.toBe(names[1]); // different names
    expect(names).toContain("board_1__backlog__reorder");
    expect(names).toContain("board_2__backlog__reorder");

    // Both resolve correctly
    expect(toolSet.resolve("board_1__backlog__reorder")).toEqual({ path: "/board-1/backlog", action: "reorder" });
    expect(toolSet.resolve("board_2__backlog__reorder")).toEqual({ path: "/board-2/backlog", action: "reorder" });
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
