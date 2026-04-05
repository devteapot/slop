import { describe, test, expect } from "bun:test";
import { affordancesToTools, formatTree } from "../src/tools";
import type { SlopNode } from "../src/types";

describe("affordancesToTools", () => {
  test("singleton affordances keep nodeId__action naming", () => {
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

  test("resolve maps singleton tool name back to path + action", () => {
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
    const resolved = toolSet.resolve("msg_1__archive");
    expect(resolved).toEqual({ path: "/inbox/msg-1", action: "archive" });
  });

  test("groups same action + schema into one tool with target param", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "backlog", type: "collection", children: [
          { id: "card-1", type: "item", affordances: [{ action: "edit", label: "Edit card", params: { type: "object", properties: { title: { type: "string" } } } }] },
          { id: "card-2", type: "item", affordances: [{ action: "edit", label: "Edit card", params: { type: "object", properties: { title: { type: "string" } } } }] },
          { id: "card-3", type: "item", affordances: [{ action: "edit", label: "Edit card", params: { type: "object", properties: { title: { type: "string" } } } }] },
        ]},
      ],
    };
    const toolSet = affordancesToTools(tree);
    // Should be 1 grouped tool, not 3 individual ones
    expect(toolSet.tools).toHaveLength(1);
    expect(toolSet.tools[0].function.name).toBe("edit");
    expect(toolSet.tools[0].function.description).toContain("3 targets");

    // Should have target param added
    const params = toolSet.tools[0].function.parameters as any;
    expect(params.properties.target).toBeDefined();
    expect(params.required).toContain("target");
    // Original params preserved
    expect(params.properties.title).toBeDefined();
  });

  test("grouped tool resolve returns null path with targets list", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "backlog", type: "collection", children: [
          { id: "card-1", type: "item", affordances: [{ action: "delete" }] },
          { id: "card-2", type: "item", affordances: [{ action: "delete" }] },
        ]},
      ],
    };
    const toolSet = affordancesToTools(tree);
    const resolved = toolSet.resolve("delete");
    expect(resolved).not.toBeNull();
    expect(resolved!.path).toBeNull();
    expect(resolved!.action).toBe("delete");
    expect(resolved!.targets).toEqual(["/backlog/card-1", "/backlog/card-2"]);
  });

  test("different schemas with same action produce separate tools", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "cards", type: "collection", children: [
          { id: "card-1", type: "item", affordances: [{ action: "edit", params: { type: "object", properties: { title: { type: "string" } } } }] },
          { id: "card-2", type: "item", affordances: [{ action: "edit", params: { type: "object", properties: { title: { type: "string" } } } }] },
        ]},
        { id: "comments", type: "collection", children: [
          { id: "comment-1", type: "item", affordances: [{ action: "edit", params: { type: "object", properties: { body: { type: "string" } } } }] },
          { id: "comment-2", type: "item", affordances: [{ action: "edit", params: { type: "object", properties: { body: { type: "string" } } } }] },
        ]},
      ],
    };
    const toolSet = affordancesToTools(tree);
    // Two groups: edit(title) and edit(body) — disambiguated names
    expect(toolSet.tools).toHaveLength(2);
    const names = toolSet.tools.map(t => t.function.name);
    expect(names[0]).not.toBe(names[1]);
    // Both should be resolvable
    expect(toolSet.resolve(names[0])).not.toBeNull();
    expect(toolSet.resolve(names[1])).not.toBeNull();
  });

  test("groups across different parent containers", () => {
    // Cards in backlog AND done should merge (same action + schema)
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "backlog", type: "collection", children: [
          { id: "card-1", type: "item", affordances: [{ action: "move" }] },
        ]},
        { id: "done", type: "collection", children: [
          { id: "card-2", type: "item", affordances: [{ action: "move" }] },
        ]},
      ],
    };
    const toolSet = affordancesToTools(tree);
    expect(toolSet.tools).toHaveLength(1);
    expect(toolSet.tools[0].function.name).toBe("move");
    const resolved = toolSet.resolve("move");
    expect(resolved!.targets).toEqual(["/backlog/card-1", "/done/card-2"]);
  });

  test("dangerous flag propagates if any entry in group is dangerous", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "a", type: "item", affordances: [{ action: "purge", dangerous: true }] },
        { id: "b", type: "item", affordances: [{ action: "purge" }] },
      ],
    };
    const toolSet = affordancesToTools(tree);
    expect(toolSet.tools).toHaveLength(1);
    expect(toolSet.tools[0].function.description).toContain("DANGEROUS");
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
