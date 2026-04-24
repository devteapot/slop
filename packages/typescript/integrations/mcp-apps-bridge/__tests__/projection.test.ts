import { describe, test, expect } from "bun:test";
import { createProjector, renderMarkdown } from "../src/projection";
import type { SlopNode } from "@slop-ai/consumer";

const tree: SlopNode = {
  id: "root",
  type: "root",
  children: [
    {
      id: "col-1",
      type: "group",
      properties: { name: "Todo" },
      affordances: [{ action: "add_card", label: "Add card" }],
      meta: { salience: 0.9 },
    },
  ],
};

describe("renderMarkdown", () => {
  test("emits state + actions sections", () => {
    const out = renderMarkdown(tree);
    expect(out).toContain("### State");
    expect(out).toContain("### Actions");
    expect(out).toContain("add_card");
  });

  test("prepends header when provided", () => {
    const out = renderMarkdown(tree, "# Kanban");
    expect(out.startsWith("# Kanban")).toBe(true);
  });

  test("handles trees with no affordances", () => {
    const bare: SlopNode = { id: "x", type: "leaf" };
    const out = renderMarkdown(bare);
    expect(out).toContain("_no actions available_");
  });
});

describe("createProjector", () => {
  test("coalesces rapid schedules into one apply", async () => {
    let calls = 0;
    let lastText = "";
    const projector = createProjector(
      (t) => {
        calls += 1;
        lastText = t;
      },
      { debounceMs: 20 },
    );

    for (let i = 0; i < 10; i++) projector.schedule(tree);
    expect(calls).toBe(0);

    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    expect(lastText).toContain("### State");
    projector.dispose();
  });

  test("flush runs pending projection synchronously", () => {
    let calls = 0;
    const projector = createProjector((_t) => {
      calls += 1;
    }, { debounceMs: 1000 });

    projector.schedule(tree);
    expect(calls).toBe(0);
    projector.flush();
    expect(calls).toBe(1);
    projector.dispose();
  });

  test("custom format function overrides markdown", () => {
    let payload = "";
    const projector = createProjector((t) => {
      payload = t;
    }, { debounceMs: 0, format: (t) => `raw:${t.id}` });

    projector.schedule(tree);
    projector.flush();
    expect(payload).toBe("raw:root");
    projector.dispose();
  });

  test("dispose cancels pending projection", async () => {
    let calls = 0;
    const projector = createProjector(() => {
      calls += 1;
    }, { debounceMs: 10 });

    projector.schedule(tree);
    projector.dispose();
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(0);
  });
});
