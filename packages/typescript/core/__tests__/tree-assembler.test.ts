import { describe, test, expect } from "bun:test";
import { assembleTree } from "../src/tree-assembler";
import type { NodeDescriptor } from "../src/types";

function makeRegs(entries: [string, NodeDescriptor][]): Map<string, NodeDescriptor> {
  return new Map(entries);
}

describe("assembleTree", () => {
  test("single node at root level", () => {
    const regs = makeRegs([
      ["notes", { type: "collection", props: { count: 3 } }],
    ]);
    const { tree } = assembleTree(regs, "app", "My App");
    expect(tree.id).toBe("app");
    expect(tree.type).toBe("root");
    expect(tree.children).toHaveLength(1);
    expect(tree.children![0].id).toBe("notes");
    expect(tree.children![0].type).toBe("collection");
    expect(tree.children![0].properties).toEqual({ count: 3 });
  });

  test("nested paths become parent-child", () => {
    const regs = makeRegs([
      ["inbox", { type: "view" }],
      ["inbox/messages", { type: "collection" }],
      ["inbox/unread", { type: "status", props: { count: 5 } }],
    ]);
    const { tree } = assembleTree(regs, "app", "App");
    const inbox = tree.children![0];
    expect(inbox.id).toBe("inbox");
    expect(inbox.children).toHaveLength(2);
    expect(inbox.children![0].id).toBe("messages");
    expect(inbox.children![1].id).toBe("unread");
  });

  test("creates synthetic parent when child registered before parent", () => {
    const regs = makeRegs([
      ["inbox/messages", { type: "collection" }],
      // "inbox" is not registered
    ]);
    const { tree } = assembleTree(regs, "app", "App");
    // Should create a synthetic "inbox" group
    const inbox = tree.children![0];
    expect(inbox.id).toBe("inbox");
    expect(inbox.type).toBe("group"); // synthetic
    expect(inbox.children).toHaveLength(1);
    expect(inbox.children![0].id).toBe("messages");
  });

  test("registered node replaces synthetic placeholder", () => {
    const regs = makeRegs([
      ["inbox/messages", { type: "collection" }],
      ["inbox", { type: "view", props: { label: "Inbox" } }],
    ]);
    const { tree } = assembleTree(regs, "app", "App");
    const inbox = tree.children![0];
    expect(inbox.id).toBe("inbox");
    expect(inbox.type).toBe("view"); // not "group" — real registration wins
    expect(inbox.properties).toEqual({ label: "Inbox" });
    expect(inbox.children).toHaveLength(1);
    expect(inbox.children![0].id).toBe("messages");
  });

  test("deeply nested paths (3+ levels)", () => {
    const regs = makeRegs([
      ["workspace", { type: "view" }],
      ["workspace/projects", { type: "collection" }],
      ["workspace/projects/board", { type: "view" }],
    ]);
    const { tree } = assembleTree(regs, "app", "App");
    const ws = tree.children![0];
    expect(ws.children![0].id).toBe("projects");
    expect(ws.children![0].children![0].id).toBe("board");
  });

  test("multiple top-level nodes", () => {
    const regs = makeRegs([
      ["inbox", { type: "view" }],
      ["settings", { type: "view" }],
      ["stats", { type: "status" }],
    ]);
    const { tree } = assembleTree(regs, "app", "App");
    expect(tree.children).toHaveLength(3);
    const ids = tree.children!.map((c) => c.id);
    expect(ids).toContain("inbox");
    expect(ids).toContain("settings");
    expect(ids).toContain("stats");
  });

  test("merges handlers from all registrations", () => {
    const fn1 = () => "a";
    const fn2 = () => "b";
    const regs = makeRegs([
      ["notes", { type: "collection", actions: { create: fn1 } }],
      ["settings", { type: "view", actions: { save: fn2 } }],
    ]);
    const { handlers } = assembleTree(regs, "app", "App");
    expect(handlers.get("notes/create")).toBe(fn1);
    expect(handlers.get("settings/save")).toBe(fn2);
  });

  test("items inside registered nodes produce handler entries", () => {
    const deleteFn = () => {};
    const regs = makeRegs([
      ["todos", {
        type: "collection",
        items: [
          { id: "t1", props: { title: "A" }, actions: { delete: deleteFn } },
        ],
      }],
    ]);
    const { tree, handlers } = assembleTree(regs, "app", "App");
    expect(tree.children![0].children![0].id).toBe("t1");
    expect(handlers.get("todos/t1/delete")).toBe(deleteFn);
  });

  test("inline children and path-registered children coexist", () => {
    const regs = makeRegs([
      ["settings", {
        type: "view",
        children: {
          account: { type: "group", props: { email: "a@b.com" } },
        },
      }],
      ["settings/notifications", { type: "group", props: { enabled: true } }],
    ]);
    const { tree } = assembleTree(regs, "app", "App");
    const settings = tree.children![0];
    expect(settings.children).toHaveLength(2);
    const ids = settings.children!.map((c) => c.id);
    expect(ids).toContain("account");
    expect(ids).toContain("notifications");
  });
});
