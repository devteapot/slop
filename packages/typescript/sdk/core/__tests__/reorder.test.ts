import { describe, expect, it } from "bun:test";
import { diffNodes } from "../src/diff";
import type { SlopNode } from "../src/types";

function n(id: string, extra: Partial<SlopNode> = {}): SlopNode {
  return { id, type: "item", ...extra };
}

describe("diff — ordered children", () => {
  it("emits a move op when a child's position changes", () => {
    const oldTree: SlopNode = { id: "r", type: "root", children: [n("a"), n("b"), n("c")] };
    const newTree: SlopNode = { id: "r", type: "root", children: [n("c"), n("a"), n("b")] };
    const ops = diffNodes(oldTree, newTree);
    const moves = ops.filter((o) => o.op === "move");
    expect(moves.length).toBeGreaterThan(0);
    // First move should place "c" at index 0.
    expect(moves[0]).toEqual({ op: "move", path: "/c", index: 0 });
  });

  it("emits no ops when order and content are unchanged", () => {
    const tree: SlopNode = { id: "r", type: "root", children: [n("a"), n("b")] };
    const ops = diffNodes(tree, JSON.parse(JSON.stringify(tree)));
    expect(ops).toEqual([]);
  });

  it("uses indexed add for inserts at non-tail positions", () => {
    const oldTree: SlopNode = { id: "r", type: "root", children: [n("a"), n("c")] };
    const newTree: SlopNode = { id: "r", type: "root", children: [n("a"), n("b"), n("c")] };
    const ops = diffNodes(oldTree, newTree);
    const add = ops.find((o) => o.op === "add");
    expect(add).toEqual({ op: "add", path: "/b", value: n("b"), index: 1 });
  });

  it("round-trips reorder through a mirror", async () => {
    const { StateMirror } = await import("../../consumer/src/state-mirror");
    const oldTree: SlopNode = { id: "r", type: "root", children: [n("a"), n("b"), n("c"), n("d")] };
    const newTree: SlopNode = { id: "r", type: "root", children: [n("d"), n("b"), n("a"), n("c")] };
    const mirror = new StateMirror({ type: "snapshot", id: "s", version: 1, tree: oldTree });
    const ops = diffNodes(oldTree, newTree);
    mirror.applyPatch({ type: "patch", subscription: "s", version: 2, ops });
    const finalIds = mirror.getTree().children!.map((c) => c.id);
    expect(finalIds).toEqual(["d", "b", "a", "c"]);
  });
});
