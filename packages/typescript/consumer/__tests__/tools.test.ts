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
  // Canonical test tree matching spec/core/state-tree.md "Consumer display format"
  const canonicalTree: SlopNode = {
    id: "store", type: "root",
    properties: { label: "Pet Store" },
    meta: { salience: 0.9 },
    affordances: [{
      action: "search",
      params: { type: "object", properties: { query: { type: "string" } } },
    }],
    children: [
      {
        id: "catalog", type: "collection",
        properties: { label: "Catalog", count: 142 },
        meta: { total_children: 142, window: [0, 25], summary: "142 products, 12 on sale" },
        children: [{
          id: "prod-1", type: "item",
          properties: { label: "Rubber Duck", price: 4.99, in_stock: true },
          affordances: [
            { action: "add_to_cart", params: { type: "object", properties: { quantity: { type: "number" } } } },
            { action: "view" },
          ],
        }],
      },
      {
        id: "cart", type: "collection",
        properties: { label: "Cart" },
        meta: { total_children: 3, summary: "3 items, $24.97" },
      },
    ],
  };

  test("header shows id and label when they differ", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain("[root] store: Pet Store");
    expect(output).toContain("[collection] catalog: Catalog");
    expect(output).toContain("[item] prod-1: Rubber Duck");
  });

  test("header shows only id when no label", () => {
    const tree: SlopNode = { id: "status", type: "status", properties: { code: 200 } };
    expect(formatTree(tree)).toContain("[status] status");
  });

  test("extra properties exclude label and title", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain("count=142");
    expect(output).toContain("price=4.99");
    expect(output).not.toMatch(/label=/);
  });

  test("meta summary is shown quoted with em-dash", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain('— "142 products, 12 on sale"');
    expect(output).toContain('— "3 items, $24.97"');
  });

  test("meta salience is shown rounded", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain("salience=0.9");
  });

  test("affordances shown inline with param types", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain("actions: {search(query: string)}");
    expect(output).toContain("actions: {add_to_cart(quantity: number), view}");
  });

  test("windowed collection shows (showing N of M)", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain("(showing 1 of 142)");
  });

  test("lazy collection shows (N children not loaded)", () => {
    const output = formatTree(canonicalTree);
    expect(output).toContain("(3 children not loaded)");
  });

  test("indentation increases per depth level", () => {
    const output = formatTree(canonicalTree);
    const lines = output.split("\n");
    // Root at indent 0
    expect(lines[0]).toMatch(/^\[root\]/);
    // Catalog at indent 1
    const catalogLine = lines.find(l => l.includes("catalog"))!;
    expect(catalogLine).toMatch(/^  \[collection\]/);
    // prod-1 at indent 2
    const prodLine = lines.find(l => l.includes("prod-1"))!;
    expect(prodLine).toMatch(/^    \[item\]/);
  });
});
