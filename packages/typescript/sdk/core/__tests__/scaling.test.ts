import { describe, test, expect } from "bun:test";
import {
  truncateTree,
  autoCompact,
  filterTree,
  prepareTree,
  getSubtree,
  countNodes,
} from "../src/scaling";
import { normalizeDescriptor } from "../src/descriptor";
import { assembleTree } from "../src/tree-assembler";
import { diffNodes } from "../src/diff";
import type { SlopNode, NodeDescriptor } from "../src/types";

// --- Helpers ---

function findNode(root: SlopNode, id: string): SlopNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function buildTree(entries: [string, NodeDescriptor][]): SlopNode {
  return assembleTree(new Map(entries), "root", "Test").tree;
}

function makeDeepTree(): SlopNode {
  return {
    id: "root", type: "root", children: [
      { id: "a", type: "view", properties: { label: "A" }, children: [
        { id: "b", type: "collection", meta: { summary: "B summary" }, children: [
          { id: "c", type: "item", properties: { x: 1 }, children: [
            { id: "d", type: "item", properties: { x: 2 } },
          ]},
        ]},
      ]},
      { id: "e", type: "view", properties: { label: "E" } },
    ],
  };
}

// ============================================================
// DESCRIPTOR FEATURES (summary, window, content_ref)
// These test normalizeDescriptor, which is where the features
// are actually implemented.
// ============================================================

describe("Summary", () => {
  test("summary maps to meta.summary", () => {
    const { node } = normalizeDescriptor("inbox", "inbox", {
      type: "view",
      summary: "142 messages, 12 unread",
    });
    expect(node.meta?.summary).toBe("142 messages, 12 unread");
  });

  test("summary merges with existing meta without overwriting", () => {
    const { node } = normalizeDescriptor("x", "x", {
      type: "view",
      summary: "my summary",
      meta: { salience: 0.9, urgency: "high" },
    });
    expect(node.meta?.summary).toBe("my summary");
    expect(node.meta?.salience).toBe(0.9);
    expect(node.meta?.urgency).toBe("high");
  });

  test("meta.summary takes precedence over summary field if both set", () => {
    const { node } = normalizeDescriptor("x", "x", {
      type: "view",
      summary: "from field",
      meta: { summary: "from meta" },
    });
    expect(node.meta?.summary).toBe("from field");
  });

  test("empty string summary is preserved", () => {
    const { node } = normalizeDescriptor("x", "x", { type: "view", summary: "" });
    expect(node.meta?.summary).toBeUndefined();
  });

  test("item summary maps to meta.summary", () => {
    const { node } = normalizeDescriptor("list", "list", {
      type: "collection",
      items: [{ id: "i1", props: { title: "test" }, summary: "A test item with details" }],
    });
    expect(node.children![0].meta?.summary).toBe("A test item with details");
  });

  test("summary in assembled tree", () => {
    const tree = buildTree([
      ["inbox", { type: "view", summary: "50 messages" }],
      ["settings", { type: "view", summary: "12 options" }],
    ]);
    expect(findNode(tree, "inbox")?.meta?.summary).toBe("50 messages");
    expect(findNode(tree, "settings")?.meta?.summary).toBe("12 options");
  });
});

describe("Windowed collections", () => {
  test("window creates children from window.items", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      window: { items: [{ id: "m1", props: { text: "Hello" } }, { id: "m2", props: { text: "World" } }], total: 500, offset: 10 },
    });
    expect(node.children).toHaveLength(2);
    expect(node.children![0].id).toBe("m1");
  });

  test("window sets meta.total_children and meta.window", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      window: { items: [{ id: "m1" }], total: 1000, offset: 50 },
    });
    expect(node.meta?.total_children).toBe(1000);
    expect(node.meta?.window).toEqual([50, 1]);
  });

  test("window with 0 items", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      window: { items: [], total: 500, offset: 0 },
    });
    expect(node.children).toBeUndefined();
    expect(node.meta?.total_children).toBe(500);
    expect(node.meta?.window).toEqual([0, 0]);
  });

  test("window + summary together", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      summary: "500 messages, 12 unread",
      window: { items: [{ id: "m1", props: { unread: true } }], total: 500, offset: 0 },
    });
    expect(node.meta?.summary).toBe("500 messages, 12 unread");
    expect(node.meta?.total_children).toBe(500);
  });

  test("window items have actions with correct handler paths", () => {
    const fn = () => {};
    const { handlers } = normalizeDescriptor("list", "list", {
      type: "collection",
      window: { items: [{ id: "item-1", actions: { delete: fn } }], total: 100, offset: 0 },
    });
    expect(handlers.get("list/item-1/delete")).toBe(fn);
  });

  test("window takes precedence over items", () => {
    const { node } = normalizeDescriptor("x", "x", {
      type: "collection",
      items: [{ id: "from-items" }],
      window: { items: [{ id: "from-window" }], total: 50, offset: 0 },
    });
    expect(node.children).toHaveLength(1);
    expect(node.children![0].id).toBe("from-window");
  });
});

describe("Content references", () => {
  test("contentRef maps to top-level content_ref field", () => {
    const { node } = normalizeDescriptor("doc", "doc", {
      type: "document",
      contentRef: { type: "text", mime: "text/markdown", summary: "A markdown document" },
    });
    expect(node.content_ref).toBeDefined();
    expect(node.content_ref!.type).toBe("text");
    expect(node.content_ref!.mime).toBe("text/markdown");
  });

  test("contentRef auto-generates slop:// URI", () => {
    const { node } = normalizeDescriptor("editor/main-ts", "main-ts", {
      type: "document",
      contentRef: { type: "text", mime: "text/typescript", summary: "TS file" },
    });
    expect(node.content_ref!.uri).toBe("slop://content/editor/main-ts");
  });

  test("contentRef preserves explicit URI", () => {
    const { node } = normalizeDescriptor("img", "img", {
      type: "document",
      contentRef: { type: "binary", mime: "image/png", summary: "Photo", uri: "https://cdn.example.com/photo.png" },
    });
    expect(node.content_ref!.uri).toBe("https://cdn.example.com/photo.png");
  });

  test("contentRef does not pollute properties", () => {
    const { node } = normalizeDescriptor("doc", "doc", {
      type: "document",
      props: { title: "Report", language: "markdown" },
      contentRef: { type: "text", mime: "text/markdown", summary: "Report doc" },
    });
    expect(node.properties?.title).toBe("Report");
    expect(node.properties?.content_ref).toBeUndefined();
    expect(node.content_ref).toBeDefined();
  });

  test("contentRef + actions together", () => {
    const readFn = () => ({ content: "hello" });
    const { node, handlers } = normalizeDescriptor("doc", "doc", {
      type: "document",
      contentRef: { type: "text", mime: "text/plain", summary: "Doc" },
      actions: { read_content: readFn },
    });
    expect(node.content_ref).toBeDefined();
    expect(node.affordances).toHaveLength(1);
    expect(handlers.get("doc/read_content")).toBe(readFn);
  });
});

// ============================================================
// truncateTree — tests the exported function directly
// ============================================================

describe("truncateTree", () => {
  test("depth 0 collapses everything except root", () => {
    const truncated = truncateTree(makeDeepTree(), 0);
    expect(truncated.children).toBeUndefined();
    expect(truncated.meta?.total_children).toBe(2);
  });

  test("depth 1 shows root + direct children only", () => {
    const truncated = truncateTree(makeDeepTree(), 1);
    expect(truncated.children).toHaveLength(2);
    expect(truncated.children![0].children).toBeUndefined();
    expect(truncated.children![0].meta?.total_children).toBe(1);
  });

  test("depth 2 shows two levels of nesting", () => {
    const truncated = truncateTree(makeDeepTree(), 2);
    const a = truncated.children![0];
    expect(a.children).toHaveLength(1);
    expect(a.children![0].id).toBe("b");
    expect(a.children![0].children).toBeUndefined();
    expect(a.children![0].meta?.total_children).toBe(1);
    expect(a.children![0].meta?.summary).toBe("B summary");
  });

  test("depth deeper than tree has no effect", () => {
    const tree = makeDeepTree();
    const truncated = truncateTree(tree, 100);
    expect(countNodes(truncated)).toBe(countNodes(tree));
  });

  test("truncated stubs preserve properties", () => {
    const truncated = truncateTree(makeDeepTree(), 1);
    expect(truncated.children![0].properties?.label).toBe("A");
  });

  test("leaf nodes unaffected", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "leaf", type: "item", properties: { x: 1 } }],
    };
    const truncated = truncateTree(tree, 0);
    expect(truncated.meta?.total_children).toBe(1);
  });
});

// ============================================================
// autoCompact — tests the exported function directly
// ============================================================

describe("autoCompact", () => {
  test("tree under budget is unchanged", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "a", type: "group" }, { id: "b", type: "group" }],
    };
    const compacted = autoCompact(tree, 100);
    expect(countNodes(compacted)).toBe(3);
  });

  test("tree over budget gets compacted", () => {
    // Collapsible nodes must NOT be root direct children (those are protected)
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "app", type: "view",
        children: [{
          id: "section", type: "collection",
          children: Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, type: "item" })),
        }],
      }],
    };
    // 13 nodes, budget 5
    const compacted = autoCompact(tree, 5);
    expect(countNodes(compacted)).toBeLessThanOrEqual(5);
  });

  test("low salience nodes collapsed before high salience", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "app", type: "view",
        children: [
          { id: "important", type: "collection", meta: { salience: 1.0 }, children: [{ id: "i1", type: "item" }, { id: "i2", type: "item" }] },
          { id: "unimportant", type: "collection", meta: { salience: 0.1 }, summary: "Low priority", children: [{ id: "u1", type: "item" }, { id: "u2", type: "item" }, { id: "u3", type: "item" }] },
        ],
      }],
    };
    // 9 nodes, budget 6 — unimportant should collapse first
    const compacted = autoCompact(tree, 6);
    const app = compacted.children![0];
    const important = app.children?.find(c => c.id === "important");
    const unimportant = app.children?.find(c => c.id === "unimportant");
    expect(important?.children?.length).toBeGreaterThan(0);
    expect(unimportant?.children).toBeUndefined();
  });

  test("summaries preserved on collapsed nodes", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "section", type: "group",
        children: [{
          id: "subsection", type: "collection",
          meta: { summary: "Important subsection with 10 items" },
          children: Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, type: "item" })),
        }],
      }],
    };
    const compacted = autoCompact(tree, 4);
    const subsection = compacted.children![0].children![0];
    expect(subsection.meta?.summary).toBe("Important subsection with 10 items");
    expect(subsection.meta?.total_children).toBe(10);
    expect(subsection.children).toBeUndefined();
  });

  test("nodes without summary get auto-generated summary", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "section", type: "group",
        children: [{ id: "list", type: "collection", children: Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, type: "item" })) }],
      }],
    };
    const compacted = autoCompact(tree, 3);
    const list = compacted.children![0].children![0];
    expect(list.meta?.summary).toBe("5 children");
    expect(list.children).toBeUndefined();
  });

  test("root direct children are never collapsed", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "nav-1", type: "view", children: [{ id: "x", type: "item" }] },
        { id: "nav-2", type: "view", children: [{ id: "y", type: "item" }] },
        { id: "nav-3", type: "view", children: [{ id: "z", type: "item" }] },
      ],
    };
    const compacted = autoCompact(tree, 4);
    expect(compacted.children).toHaveLength(3);
  });
});

// ============================================================
// filterTree — tests the new exported function
// ============================================================

describe("filterTree", () => {
  test("filters by min_salience", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "high", type: "item", meta: { salience: 0.9 } },
        { id: "low", type: "item", meta: { salience: 0.1 } },
        { id: "mid", type: "item", meta: { salience: 0.5 } },
      ],
    };
    const filtered = filterTree(tree, 0.5);
    expect(filtered.children).toHaveLength(2);
    const ids = filtered.children!.map(c => c.id);
    expect(ids).toContain("high");
    expect(ids).toContain("mid");
    expect(ids).not.toContain("low");
  });

  test("filters by types", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "a", type: "item" },
        { id: "b", type: "notification" },
        { id: "c", type: "status" },
      ],
    };
    const filtered = filterTree(tree, undefined, ["item", "notification"]);
    expect(filtered.children).toHaveLength(2);
    const ids = filtered.children!.map(c => c.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  test("default salience is 0.5 for unset nodes", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "no-meta", type: "item" },
        { id: "has-meta", type: "item", meta: { salience: 0.3 } },
      ],
    };
    const filtered = filterTree(tree, 0.4);
    expect(filtered.children).toHaveLength(1);
    expect(filtered.children![0].id).toBe("no-meta");
  });

  test("filters recursively", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "parent", type: "group", meta: { salience: 0.9 },
        children: [
          { id: "keep", type: "item", meta: { salience: 0.8 } },
          { id: "drop", type: "item", meta: { salience: 0.1 } },
        ],
      }],
    };
    const filtered = filterTree(tree, 0.5);
    expect(filtered.children![0].children).toHaveLength(1);
    expect(filtered.children![0].children![0].id).toBe("keep");
  });

  test("combined salience + types filter", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "a", type: "notification", meta: { salience: 0.9 } },
        { id: "b", type: "notification", meta: { salience: 0.1 } },
        { id: "c", type: "item", meta: { salience: 0.9 } },
      ],
    };
    const filtered = filterTree(tree, 0.5, ["notification"]);
    expect(filtered.children).toHaveLength(1);
    expect(filtered.children![0].id).toBe("a");
  });
});

// ============================================================
// getSubtree — tests the new exported function
// ============================================================

describe("getSubtree", () => {
  const tree: SlopNode = {
    id: "root", type: "root",
    children: [
      { id: "inbox", type: "view", children: [
        { id: "msg-1", type: "item", properties: { subject: "Hello" } },
      ]},
      { id: "settings", type: "view" },
    ],
  };

  test("root path returns root", () => {
    expect(getSubtree(tree, "/")).toBe(tree);
    expect(getSubtree(tree, "")).toBe(tree);
  });

  test("finds first-level child", () => {
    const sub = getSubtree(tree, "/inbox");
    expect(sub?.id).toBe("inbox");
  });

  test("finds nested child", () => {
    const sub = getSubtree(tree, "/inbox/msg-1");
    expect(sub?.id).toBe("msg-1");
    expect(sub?.properties?.subject).toBe("Hello");
  });

  test("returns undefined for missing path", () => {
    expect(getSubtree(tree, "/nonexistent")).toBeUndefined();
    expect(getSubtree(tree, "/inbox/msg-99")).toBeUndefined();
  });
});

// ============================================================
// prepareTree — tests the combined pipeline
// ============================================================

describe("prepareTree", () => {
  test("applies maxDepth + minSalience + maxNodes together", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "important", type: "view", meta: { salience: 0.9 }, children: [
          { id: "deep", type: "group", children: [{ id: "leaf", type: "item" }] },
        ]},
        { id: "noise", type: "item", meta: { salience: 0.1 } },
      ],
    };
    const result = prepareTree(tree, { maxDepth: 1, minSalience: 0.5, maxNodes: 10 });
    // noise filtered by salience
    expect(result.children?.find(c => c.id === "noise")).toBeUndefined();
    // important present but truncated at depth 1
    const imp = result.children?.find(c => c.id === "important");
    expect(imp).toBeDefined();
    expect(imp!.children).toBeUndefined();
    expect(imp!.meta?.total_children).toBe(1);
  });

  test("no options returns tree unchanged", () => {
    const tree = makeDeepTree();
    const result = prepareTree(tree, {});
    expect(countNodes(result)).toBe(countNodes(tree));
  });
});

// ============================================================
// Pinned nodes — tests through autoCompact
// ============================================================

describe("Pinned nodes", () => {
  test("pinned node is never collapsed by auto-compaction", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "data", type: "group", meta: { salience: 0.3 }, children: Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, type: "item" })) },
        { id: "ui", type: "view", meta: { pinned: true, salience: 0.5 }, children: [
          { id: "filters", type: "status" },
          { id: "compose", type: "view" },
        ]},
      ],
    };
    const compacted = autoCompact(tree, 5);
    const ui = compacted.children?.find(c => c.id === "ui");
    expect(ui!.children).toBeDefined();
    expect(ui!.children!.length).toBe(2);
  });

  test("pinned node with low salience still survives compaction", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "high-salience", type: "group", meta: { salience: 1.0 }, children: [{ id: "h1", type: "item" }, { id: "h2", type: "item" }] },
        { id: "pinned-low", type: "group", meta: { pinned: true, salience: 0.1 }, children: [{ id: "p1", type: "item" }, { id: "p2", type: "item" }] },
      ],
    };
    const compacted = autoCompact(tree, 4);
    const pinnedNode = compacted.children?.find(c => c.id === "pinned-low");
    expect(pinnedNode!.children).toBeDefined();
    expect(pinnedNode!.children!.length).toBe(2);
  });

  test("non-pinned sibling is collapsed while pinned sibling survives", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "app", type: "view",
        children: [
          { id: "collapsible", type: "collection", children: Array.from({ length: 8 }, (_, i) => ({ id: `c-${i}`, type: "item" })) },
          { id: "protected", type: "view", meta: { pinned: true }, children: [{ id: "route", type: "status" }, { id: "filter", type: "status" }] },
        ],
      }],
    };
    const compacted = autoCompact(tree, 6);
    const app = compacted.children![0];
    expect(app.children?.find(c => c.id === "protected")!.children!.length).toBe(2);
    expect(app.children?.find(c => c.id === "collapsible")!.children).toBeUndefined();
  });

  test("all nodes pinned means nothing can be collapsed", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "a", type: "group", meta: { pinned: true },
        children: [{ id: "b", type: "collection", meta: { pinned: true }, children: [{ id: "c1", type: "item" }, { id: "c2", type: "item" }] }],
      }],
    };
    const compacted = autoCompact(tree, 2);
    expect(countNodes(compacted)).toBe(5);
  });
});

// ============================================================
// Patching correctness with scaling features (diff)
// ============================================================

describe("Patching with scaling features", () => {
  test("changing summary produces a patch", () => {
    const old: SlopNode = { id: "root", type: "root", children: [{ id: "inbox", type: "view", meta: { summary: "10 messages" } }] };
    const nw: SlopNode = { id: "root", type: "root", children: [{ id: "inbox", type: "view", meta: { summary: "11 messages" } }] };
    const ops = diffNodes(old, nw);
    expect(ops.some(op => op.path.includes("meta") && op.op === "replace")).toBe(true);
  });

  test("changing window items produces patches", () => {
    const old: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "list", type: "collection", meta: { total_children: 100, window: [0, 2] as [number, number] }, children: [
        { id: "item-0", type: "item", properties: { text: "A" } },
        { id: "item-1", type: "item", properties: { text: "B" } },
      ]}],
    };
    const nw: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "list", type: "collection", meta: { total_children: 100, window: [2, 2] as [number, number] }, children: [
        { id: "item-2", type: "item", properties: { text: "C" } },
        { id: "item-3", type: "item", properties: { text: "D" } },
      ]}],
    };
    const ops = diffNodes(old, nw);
    expect(ops.filter(op => op.op === "remove")).toHaveLength(2);
    expect(ops.filter(op => op.op === "add")).toHaveLength(2);
  });

  test("adding content_ref produces a patch", () => {
    const old: SlopNode = { id: "root", type: "root", children: [{ id: "doc", type: "document", properties: { title: "test" } }] };
    const nw: SlopNode = { id: "root", type: "root", children: [{ id: "doc", type: "document", properties: { title: "test" }, content_ref: { type: "text", mime: "text/plain", summary: "Doc" } }] };
    const ops = diffNodes(old, nw);
    expect(ops.some(op => op.path.includes("content_ref"))).toBe(true);
  });

  test("no diff when tree is identical", () => {
    const tree: SlopNode = {
      id: "root", type: "root", meta: { summary: "test" },
      children: [{ id: "list", type: "collection", meta: { total_children: 100, window: [0, 5] as [number, number] }, children: Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, type: "item" })) }],
    };
    expect(diffNodes(tree, structuredClone(tree))).toHaveLength(0);
  });
});

// ============================================================
// Edge cases
// ============================================================

describe("Edge cases", () => {
  test("huge flat tree (1000 children)", () => {
    const tree = buildTree(Array.from({ length: 1000 }, (_, i) => [`item-${i}`, { type: "item", props: { index: i } }] as [string, NodeDescriptor]));
    expect(countNodes(tree)).toBe(1001);
  });

  test("deeply nested chain (20 levels)", () => {
    const regs: [string, NodeDescriptor][] = [];
    let path = "";
    for (let i = 0; i < 20; i++) {
      path = path ? `${path}/level-${i}` : `level-${i}`;
      regs.push([path, { type: "group" }]);
    }
    const tree = buildTree(regs);
    let node: SlopNode | undefined = tree;
    for (let i = 0; i < 20; i++) {
      node = node?.children?.[0];
      expect(node?.id).toBe(`level-${i}`);
    }
  });

  test("deeply nested chain with maxDepth: 4", () => {
    const regs: [string, NodeDescriptor][] = [];
    let path = "";
    for (let i = 0; i < 10; i++) {
      path = path ? `${path}/l${i}` : `l${i}`;
      regs.push([path, { type: "group", summary: `Level ${i}` }]);
    }
    const tree = buildTree(regs);
    const truncated = truncateTree(tree, 4);
    // root(0) → l0(1) → l1(2) → l2(3) → l3(4) truncated
    let node: SlopNode | undefined = truncated;
    for (let i = 0; i < 4; i++) {
      node = node?.children?.[0];
      expect(node).toBeDefined();
    }
    const l3 = node;
    expect(l3?.id).toBe("l3");
    if (l3?.children?.[0]) {
      expect(l3.children[0].meta?.total_children).toBeDefined();
    }
  });

  test("single node tree", () => {
    const tree = buildTree([]);
    expect(countNodes(tree)).toBe(1);
  });

  test("tree with mixed features", () => {
    const tree = buildTree([
      ["profile", { type: "view", summary: "User profile" }],
      ["messages", { type: "collection", summary: "500 messages", window: { items: [{ id: "m1", props: { text: "Hi" } }], total: 500, offset: 0 } }],
      ["editor", { type: "document", props: { title: "main.ts" }, contentRef: { type: "text", mime: "text/typescript", summary: "TS file" } }],
    ]);
    expect(countNodes(tree)).toBe(5);
    expect(findNode(tree, "profile")?.meta?.summary).toBe("User profile");
    expect(findNode(tree, "messages")?.meta?.total_children).toBe(500);
    expect(findNode(tree, "editor")?.content_ref).toBeDefined();
  });

  test("maxNodes on tree where all nodes have same salience", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "shallow", type: "group", children: [{ id: "s1", type: "item" }] },
        { id: "deep", type: "group", children: [{ id: "d1", type: "group", children: [{ id: "d2", type: "group", children: [{ id: "d3", type: "item" }] }] }] },
      ],
    };
    const compacted = autoCompact(tree, 5);
    expect(countNodes(compacted)).toBeLessThanOrEqual(5);
  });

  test("window with very large offset", () => {
    const { node } = normalizeDescriptor("list", "list", {
      type: "collection",
      window: { items: [{ id: "m999999" }], total: 1000000, offset: 999999 },
    });
    expect(node.meta?.total_children).toBe(1000000);
    expect(node.meta?.window).toEqual([999999, 1]);
  });
});
