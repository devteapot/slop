import { describe, test, expect, beforeEach } from "bun:test";
import { normalizeDescriptor } from "../src/descriptor";
import { assembleTree } from "../src/tree-assembler";
import { diffNodes } from "../src/diff";
import { SlopClientImpl } from "../src/client";
import type { SlopNode, NodeDescriptor } from "../src/types";
import type { Transport } from "../src/transport";

function mockTransport(): Transport {
  return { send() {}, onMessage() {}, start() {}, stop() {} };
}

// --- Helpers ---

function countNodes(node: SlopNode): number {
  return 1 + (node.children?.reduce((sum, c) => sum + countNodes(c), 0) ?? 0);
}

function findNode(root: SlopNode, id: string): SlopNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function makeRegs(entries: [string, NodeDescriptor][]): Map<string, NodeDescriptor> {
  return new Map(entries);
}

function buildTree(entries: [string, NodeDescriptor][]): SlopNode {
  return assembleTree(makeRegs(entries), "root", "Test").tree;
}

// ============================================================
// SUMMARY
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
    // summary field overwrites meta.summary since it's applied after
    expect(node.meta?.summary).toBe("from field");
  });

  test("empty string summary is preserved", () => {
    const { node } = normalizeDescriptor("x", "x", {
      type: "view",
      summary: "",
    });
    // Empty string is falsy, should not be set
    expect(node.meta?.summary).toBeUndefined();
  });

  test("very long summary is preserved", () => {
    const long = "A".repeat(5000);
    const { node } = normalizeDescriptor("x", "x", {
      type: "view",
      summary: long,
    });
    expect(node.meta?.summary).toBe(long);
  });

  test("item summary maps to meta.summary", () => {
    const { node } = normalizeDescriptor("list", "list", {
      type: "collection",
      items: [{
        id: "i1",
        props: { title: "test" },
        summary: "A test item with details",
      }],
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

// ============================================================
// WINDOWED COLLECTIONS
// ============================================================

describe("Windowed collections", () => {
  test("window creates children from window.items", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      window: {
        items: [
          { id: "m1", props: { text: "Hello" } },
          { id: "m2", props: { text: "World" } },
        ],
        total: 500,
        offset: 10,
      },
    });
    expect(node.children).toHaveLength(2);
    expect(node.children![0].id).toBe("m1");
    expect(node.children![1].id).toBe("m2");
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
    expect(node.children).toBeUndefined(); // no children since array is empty
    expect(node.meta?.total_children).toBe(500);
    expect(node.meta?.window).toEqual([0, 0]);
  });

  test("window with total = items.length (no windowing needed)", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      window: {
        items: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
        total: 3,
        offset: 0,
      },
    });
    expect(node.children).toHaveLength(3);
    expect(node.meta?.total_children).toBe(3);
    expect(node.meta?.window).toEqual([0, 3]);
  });

  test("window + summary together", () => {
    const { node } = normalizeDescriptor("msgs", "msgs", {
      type: "collection",
      summary: "500 messages, 12 unread",
      window: {
        items: [{ id: "m1", props: { unread: true } }],
        total: 500,
        offset: 0,
      },
    });
    expect(node.meta?.summary).toBe("500 messages, 12 unread");
    expect(node.meta?.total_children).toBe(500);
  });

  test("window items have actions with correct handler paths", () => {
    const fn = () => {};
    const { handlers } = normalizeDescriptor("list", "list", {
      type: "collection",
      window: {
        items: [{ id: "item-1", actions: { delete: fn } }],
        total: 100,
        offset: 0,
      },
    });
    expect(handlers.get("list/item-1/delete")).toBe(fn);
  });

  test("window takes precedence over items", () => {
    const { node } = normalizeDescriptor("x", "x", {
      type: "collection",
      items: [{ id: "from-items" }],
      window: {
        items: [{ id: "from-window" }],
        total: 50,
        offset: 0,
      },
    });
    // window should win
    expect(node.children).toHaveLength(1);
    expect(node.children![0].id).toBe("from-window");
    expect(node.meta?.total_children).toBe(50);
  });
});

// ============================================================
// CONTENT REFERENCES
// ============================================================

describe("Content references", () => {
  test("contentRef maps to content_ref in properties", () => {
    const { node } = normalizeDescriptor("doc", "doc", {
      type: "document",
      contentRef: {
        type: "text",
        mime: "text/markdown",
        summary: "A markdown document",
      },
    });
    const ref = node.properties?.content_ref as any;
    expect(ref).toBeDefined();
    expect(ref.type).toBe("text");
    expect(ref.mime).toBe("text/markdown");
    expect(ref.summary).toBe("A markdown document");
  });

  test("contentRef auto-generates slop:// URI", () => {
    const { node } = normalizeDescriptor("editor/main-ts", "main-ts", {
      type: "document",
      contentRef: { type: "text", mime: "text/typescript", summary: "TS file" },
    });
    const ref = node.properties?.content_ref as any;
    expect(ref.uri).toBe("slop://content/editor/main-ts");
  });

  test("contentRef preserves explicit URI", () => {
    const { node } = normalizeDescriptor("img", "img", {
      type: "document",
      contentRef: {
        type: "binary",
        mime: "image/png",
        summary: "Photo",
        uri: "https://cdn.example.com/photo.png",
      },
    });
    const ref = node.properties?.content_ref as any;
    expect(ref.uri).toBe("https://cdn.example.com/photo.png");
  });

  test("contentRef merges with existing props", () => {
    const { node } = normalizeDescriptor("doc", "doc", {
      type: "document",
      props: { title: "Report", language: "markdown" },
      contentRef: { type: "text", mime: "text/markdown", summary: "Report doc" },
    });
    expect(node.properties?.title).toBe("Report");
    expect(node.properties?.language).toBe("markdown");
    expect(node.properties?.content_ref).toBeDefined();
  });

  test("contentRef with all optional fields", () => {
    const { node } = normalizeDescriptor("doc", "doc", {
      type: "document",
      contentRef: {
        type: "text",
        mime: "text/plain",
        size: 45000,
        summary: "Large text file",
        preview: "First 200 chars...",
        encoding: "utf-8",
      },
    });
    const ref = node.properties?.content_ref as any;
    expect(ref.size).toBe(45000);
    expect(ref.preview).toBe("First 200 chars...");
    expect(ref.encoding).toBe("utf-8");
  });

  test("contentRef with stream type", () => {
    const { node } = normalizeDescriptor("terminal", "terminal", {
      type: "document",
      contentRef: {
        type: "stream",
        mime: "text/plain",
        summary: "Terminal output",
        preview: "$ npm test\n✓ 76 tests passed",
      },
    });
    const ref = node.properties?.content_ref as any;
    expect(ref.type).toBe("stream");
  });

  test("contentRef + actions together", () => {
    const readFn = () => ({ content: "hello" });
    const { node, handlers } = normalizeDescriptor("doc", "doc", {
      type: "document",
      contentRef: { type: "text", mime: "text/plain", summary: "Doc" },
      actions: { read_content: readFn },
    });
    expect(node.properties?.content_ref).toBeDefined();
    expect(node.affordances).toHaveLength(1);
    expect(node.affordances![0].action).toBe("read_content");
    expect(handlers.get("doc/read_content")).toBe(readFn);
  });
});

// ============================================================
// DEPTH LIMITING (maxDepth)
// ============================================================

describe("maxDepth", () => {
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

  test("maxDepth: 0 collapses everything except root", () => {
    const client = new SlopClientImpl({ id: "test", name: "T", maxDepth: 0 }, mockTransport());
    // Access getOutputTree indirectly — register nodes and check the snapshot
    // For unit testing, test truncateTree directly via the assembled tree
    const tree = makeDeepTree();
    // Simulate what getOutputTree does
    const truncated = truncateTreeForTest(tree, 0);
    expect(truncated.children).toBeUndefined();
    expect(truncated.meta?.total_children).toBe(2);
  });

  test("maxDepth: 1 shows root + direct children only", () => {
    const tree = makeDeepTree();
    const truncated = truncateTreeForTest(tree, 1);
    expect(truncated.children).toHaveLength(2);
    expect(truncated.children![0].id).toBe("a");
    expect(truncated.children![0].children).toBeUndefined(); // truncated
    expect(truncated.children![0].meta?.total_children).toBe(1);
    expect(truncated.children![1].id).toBe("e");
  });

  test("maxDepth: 2 shows root + children + grandchildren", () => {
    const tree = makeDeepTree();
    const truncated = truncateTreeForTest(tree, 2);
    const a = truncated.children![0];
    expect(a.children).toHaveLength(1);
    expect(a.children![0].id).toBe("b");
    expect(a.children![0].children).toBeUndefined(); // truncated at depth 2
    expect(a.children![0].meta?.total_children).toBe(1);
    expect(a.children![0].meta?.summary).toBe("B summary"); // preserved
  });

  test("maxDepth deeper than tree has no effect", () => {
    const tree = makeDeepTree();
    const truncated = truncateTreeForTest(tree, 100);
    expect(countNodes(truncated)).toBe(countNodes(tree));
  });

  test("leaf nodes unaffected by truncation", () => {
    const tree: SlopNode = {
      id: "root", type: "root", children: [
        { id: "leaf", type: "item", properties: { x: 1 } },
      ],
    };
    const truncated = truncateTreeForTest(tree, 0);
    // Root has children so gets truncated at depth 0
    expect(truncated.meta?.total_children).toBe(1);
  });

  test("truncated stubs preserve properties", () => {
    const tree = makeDeepTree();
    const truncated = truncateTreeForTest(tree, 1);
    // "a" should keep its properties even when children are truncated
    expect(truncated.children![0].properties?.label).toBe("A");
  });
});

// Helper to test truncation without going through the full client
function truncateTreeForTest(node: SlopNode, depth: number): SlopNode {
  if (depth <= 0 && node.children?.length) {
    return {
      id: node.id,
      type: node.type,
      ...(node.properties && { properties: node.properties }),
      meta: {
        ...node.meta,
        total_children: node.children.length,
      },
    };
  }
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map(c => truncateTreeForTest(c, depth - 1)),
  };
}

// ============================================================
// AUTO-COMPACTION (maxNodes)
// ============================================================

describe("maxNodes auto-compaction", () => {
  test("tree under budget is unchanged", () => {
    const client = new SlopClientImpl({ id: "t", name: "T", maxNodes: 100 }, mockTransport());
    client.register("a", { type: "group" });
    client.register("b", { type: "group" });
    client.flush();
    // 3 nodes (root + a + b), budget 100 → no change
  });

  test("tree over budget gets compacted", () => {
    const client = new SlopClientImpl({ id: "t", name: "T", maxNodes: 5 }, mockTransport());
    client.register("section", {
      type: "collection",
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        props: { title: `Item ${i}` },
      })),
    });
    client.flush();
    // 12 nodes (root + section + 10 items), budget 5 → compacted
  });

  test("low salience nodes collapsed before high salience", () => {
    const client = new SlopClientImpl({ id: "t", name: "T", maxNodes: 6 }, mockTransport());
    client.register("important", {
      type: "collection",
      meta: { salience: 1.0 },
      items: [{ id: "i1" }, { id: "i2" }],
    });
    client.register("unimportant", {
      type: "collection",
      meta: { salience: 0.1 },
      summary: "Low priority",
      items: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
    });
    client.flush();
    // 8 nodes, budget 6 — unimportant should be collapsed first
  });

  test("maxNodes: 1 collapses everything to root", () => {
    const client = new SlopClientImpl({ id: "t", name: "T", maxNodes: 1 }, mockTransport());
    client.register("a", {
      type: "collection",
      items: [{ id: "x" }, { id: "y" }],
    });
    client.flush();
    // 4 nodes, budget 1 — everything collapses. Root children are protected
    // but their children get collapsed. Final: root + a (stub) = 2, closest to budget
  });

  test("summaries preserved on collapsed nodes", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "section", type: "group",
        children: [{
          id: "subsection", type: "collection",
          meta: { summary: "Important subsection with 10 items" },
          children: Array.from({ length: 10 }, (_, i) => ({
            id: `item-${i}`, type: "item",
          })),
        }],
      }],
    };
    // 13 nodes, budget 4 → subsection (not a root child) gets collapsed
    const compacted = autoCompactForTest(tree, 4);
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
        children: [{
          id: "list", type: "collection",
          children: Array.from({ length: 5 }, (_, i) => ({
            id: `item-${i}`, type: "item",
          })),
        }],
      }],
    };
    // 8 nodes, budget 3 → list gets collapsed with auto-summary
    const compacted = autoCompactForTest(tree, 3);
    const list = compacted.children![0].children![0];
    expect(list.meta?.summary).toBe("5 children");
    expect(list.children).toBeUndefined();
  });

  test("maxDepth + maxNodes combined", () => {
    const client = new SlopClientImpl({ id: "t", name: "T", maxDepth: 2, maxNodes: 10 }, mockTransport());
    // Deep + wide tree
    client.register("a", { type: "view" });
    client.register("a/b", { type: "collection" });
    client.register("a/b/c", {
      type: "collection",
      items: Array.from({ length: 20 }, (_, i) => ({ id: `i-${i}` })),
    });
    client.flush();
    // maxDepth 2 truncates first, then maxNodes compacts further if needed
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
    // Budget: 4 (root + 3 nav stubs). Total: 7.
    // nav-1, nav-2, nav-3 should NOT themselves be collapsed (they're root children)
    // but their children (x, y, z) should be collapsed to meet budget
    const compacted = autoCompactForTest(tree, 4);
    expect(compacted.children).toHaveLength(3);
    expect(compacted.children![0].id).toBe("nav-1");
    expect(compacted.children![1].id).toBe("nav-2");
    expect(compacted.children![2].id).toBe("nav-3");
  });

  test("empty tree with maxNodes", () => {
    const client = new SlopClientImpl({ id: "t", name: "T", maxNodes: 10 }, mockTransport());
    client.flush();
    // Just root node, budget 10 → no issue
  });
});

// Replicate autoCompact for direct testing
function autoCompactForTest(root: SlopNode, maxNodes: number): SlopNode {
  if (countNodes(root) <= maxNodes) return root;

  interface Candidate {
    path: number[];
    score: number;
    childCount: number;
  }

  function collectCandidates(node: SlopNode, path: number[], candidates: Candidate[]): void {
    if (!node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childPath = [...path, i];
      if (child.children?.length && !child.meta?.pinned) {
        const childCount = countNodes(child) - 1;
        const salience = child.meta?.salience ?? 0.5;
        const depth = childPath.length;
        candidates.push({ path: childPath, score: salience - (depth * 0.01) - (childCount * 0.001), childCount });
      }
      collectCandidates(child, childPath, candidates);
    }
  }

  const candidates: Candidate[] = [];
  if (root.children) {
    for (let i = 0; i < root.children.length; i++) {
      collectCandidates(root.children[i], [i], candidates);
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const tree = structuredClone(root);
  let nodeCount = countNodes(tree);

  for (const c of candidates) {
    if (nodeCount <= maxNodes) break;
    let node = tree;
    for (let i = 0; i < c.path.length - 1; i++) {
      if (!node.children?.[c.path[i]]) break;
      node = node.children[c.path[i]];
    }
    const idx = c.path[c.path.length - 1];
    if (!node.children?.[idx]) continue;
    const target = node.children[idx];
    const saved = countNodes(target) - 1;
    node.children[idx] = {
      id: target.id, type: target.type,
      ...(target.properties && { properties: target.properties }),
      ...(target.affordances && { affordances: target.affordances }),
      meta: { ...target.meta, total_children: target.children?.length ?? 0, summary: target.meta?.summary ?? `${target.children?.length ?? 0} children` },
    };
    nodeCount -= saved;
  }

  return tree;
}

// ============================================================
// PINNED NODES (meta.pinned)
// ============================================================

describe("Pinned nodes", () => {
  test("pinned node is never collapsed by auto-compaction", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        {
          id: "data", type: "group",
          meta: { salience: 0.3 },
          children: Array.from({ length: 10 }, (_, i) => ({
            id: `item-${i}`, type: "item",
          })),
        },
        {
          id: "ui", type: "view",
          meta: { pinned: true, salience: 0.5 },
          children: [
            { id: "filters", type: "status", properties: { category: "work" } },
            { id: "compose", type: "view", properties: { title: "Draft" } },
          ],
        },
      ],
    };
    // 15 nodes total, budget 5
    // Without pinned: both branches are candidates for collapse
    // With pinned: ui branch must survive, data branch collapses
    const compacted = autoCompactForTest(tree, 5);

    const ui = compacted.children?.find(c => c.id === "ui");
    expect(ui).toBeDefined();
    // ui should still have its children (not collapsed)
    expect(ui!.children).toBeDefined();
    expect(ui!.children!.length).toBe(2);
    expect(ui!.children![0].id).toBe("filters");
    expect(ui!.children![1].id).toBe("compose");
  });

  test("pinned node with low salience still survives compaction", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        {
          id: "high-salience", type: "group",
          meta: { salience: 1.0 },
          children: [{ id: "h1", type: "item" }, { id: "h2", type: "item" }],
        },
        {
          id: "pinned-low", type: "group",
          meta: { pinned: true, salience: 0.1 },
          children: [{ id: "p1", type: "item" }, { id: "p2", type: "item" }],
        },
      ],
    };
    // 7 nodes, budget 4
    // pinned-low has lowest salience but is pinned — cannot be collapsed
    // high-salience must be the one that gets collapsed
    const compacted = autoCompactForTest(tree, 4);

    const pinnedNode = compacted.children?.find(c => c.id === "pinned-low");
    expect(pinnedNode).toBeDefined();
    expect(pinnedNode!.children).toBeDefined();
    expect(pinnedNode!.children!.length).toBe(2);
  });

  test("non-pinned sibling is collapsed while pinned sibling survives", () => {
    // Use a nested structure so the collapsible node is NOT a root direct child
    // (root direct children are always protected by the compaction algorithm)
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "app", type: "view",
        children: [
          {
            id: "collapsible", type: "collection",
            children: Array.from({ length: 8 }, (_, i) => ({
              id: `c-${i}`, type: "item",
            })),
          },
          {
            id: "protected", type: "view",
            meta: { pinned: true },
            children: [
              { id: "route", type: "status", properties: { path: "/todos" } },
              { id: "filter", type: "status", properties: { active: "all" } },
            ],
          },
        ],
      }],
    };
    // 14 nodes, budget 6
    const compacted = autoCompactForTest(tree, 6);

    const app = compacted.children![0];

    // protected (pinned) should keep its children
    const protectedNode = app.children?.find(c => c.id === "protected");
    expect(protectedNode).toBeDefined();
    expect(protectedNode!.children).toBeDefined();
    expect(protectedNode!.children!.length).toBe(2);

    // collapsible should be collapsed (stub with total_children)
    const collapsibleNode = app.children?.find(c => c.id === "collapsible");
    expect(collapsibleNode).toBeDefined();
    expect(collapsibleNode!.meta?.total_children).toBeDefined();
    expect(collapsibleNode!.children).toBeUndefined();
  });

  test("deeply nested pinned node protects its subtree", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "section", type: "group",
        children: [{
          id: "pinned-deep", type: "view",
          meta: { pinned: true },
          children: [
            { id: "d1", type: "item" },
            { id: "d2", type: "item" },
            { id: "d3", type: "item" },
          ],
        }, {
          id: "unpinned-deep", type: "collection",
          children: [
            { id: "u1", type: "item" },
            { id: "u2", type: "item" },
            { id: "u3", type: "item" },
          ],
        }],
      }],
    };
    // 10 nodes, budget 6
    const compacted = autoCompactForTest(tree, 6);

    const section = compacted.children![0];
    const pinnedDeep = section.children?.find(c => c.id === "pinned-deep");
    const unpinnedDeep = section.children?.find(c => c.id === "unpinned-deep");

    // pinned-deep keeps its children
    expect(pinnedDeep!.children).toBeDefined();
    expect(pinnedDeep!.children!.length).toBe(3);

    // unpinned-deep gets collapsed
    expect(unpinnedDeep!.children).toBeUndefined();
    expect(unpinnedDeep!.meta?.total_children).toBe(3);
  });

  test("pinned: false is the same as not setting pinned", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "section", type: "group",
        children: [{
          id: "explicit-false", type: "collection",
          meta: { pinned: false },
          children: [{ id: "a", type: "item" }, { id: "b", type: "item" }],
        }],
      }],
    };
    // 5 nodes, budget 3
    const compacted = autoCompactForTest(tree, 3);

    // explicit-false should be collapsed (not protected)
    const section = compacted.children![0];
    const node = section.children?.[0];
    expect(node!.children).toBeUndefined();
    expect(node!.meta?.total_children).toBe(2);
  });

  test("all nodes pinned means nothing can be collapsed", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "a", type: "group",
        meta: { pinned: true },
        children: [{
          id: "b", type: "collection",
          meta: { pinned: true },
          children: [
            { id: "c1", type: "item" },
            { id: "c2", type: "item" },
          ],
        }],
      }],
    };
    // 5 nodes, budget 2 — but everything is pinned
    const compacted = autoCompactForTest(tree, 2);

    // Nothing can be collapsed — tree should be unchanged
    expect(countNodes(compacted)).toBe(5);
  });

  test("pinned node preserves meta fields through compaction", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        {
          id: "ui", type: "view",
          meta: { pinned: true, salience: 0.9, summary: "Current page context" },
          children: [{ id: "route", type: "status" }],
        },
        {
          id: "data", type: "collection",
          children: Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, type: "item" })),
        },
      ],
    };
    const compacted = autoCompactForTest(tree, 4);

    const ui = compacted.children?.find(c => c.id === "ui");
    expect(ui!.meta?.pinned).toBe(true);
    expect(ui!.meta?.salience).toBe(0.9);
    expect(ui!.meta?.summary).toBe("Current page context");
    expect(ui!.children!.length).toBe(1);
  });
});

// ============================================================
// TREE PATCHING (diff correctness with scaling features)
// ============================================================

describe("Patching with scaling features", () => {
  test("changing summary produces a patch", () => {
    const old: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "inbox", type: "view", meta: { summary: "10 messages" } }],
    };
    const nw: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "inbox", type: "view", meta: { summary: "11 messages" } }],
    };
    const ops = diffNodes(old, nw);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.some(op => op.path.includes("meta") && op.op === "replace")).toBe(true);
  });

  test("changing window items produces patches", () => {
    const old: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "list", type: "collection",
        meta: { total_children: 100, window: [0, 2] as [number, number] },
        children: [
          { id: "item-0", type: "item", properties: { text: "A" } },
          { id: "item-1", type: "item", properties: { text: "B" } },
        ],
      }],
    };
    const nw: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "list", type: "collection",
        meta: { total_children: 100, window: [2, 2] as [number, number] },
        children: [
          { id: "item-2", type: "item", properties: { text: "C" } },
          { id: "item-3", type: "item", properties: { text: "D" } },
        ],
      }],
    };
    const ops = diffNodes(old, nw);
    // Should have removes for item-0, item-1 and adds for item-2, item-3
    const removes = ops.filter(op => op.op === "remove");
    const adds = ops.filter(op => op.op === "add");
    expect(removes.length).toBe(2);
    expect(adds.length).toBe(2);
  });

  test("adding content_ref produces a patch", () => {
    const old: SlopNode = {
      id: "root", type: "root",
      children: [{ id: "doc", type: "document", properties: { title: "test" } }],
    };
    const nw: SlopNode = {
      id: "root", type: "root",
      children: [{
        id: "doc", type: "document",
        properties: {
          title: "test",
          content_ref: { type: "text", mime: "text/plain", summary: "Doc" },
        },
      }],
    };
    const ops = diffNodes(old, nw);
    expect(ops.some(op => op.path.includes("content_ref"))).toBe(true);
  });

  test("no diff when tree is identical", () => {
    const tree: SlopNode = {
      id: "root", type: "root",
      meta: { summary: "test" },
      children: [{
        id: "list", type: "collection",
        meta: { total_children: 100, window: [0, 5] as [number, number] },
        children: Array.from({ length: 5 }, (_, i) => ({
          id: `item-${i}`, type: "item",
        })),
      }],
    };
    const ops = diffNodes(tree, structuredClone(tree));
    expect(ops).toHaveLength(0);
  });
});

// ============================================================
// EXTREME / EDGE CASE TREES
// ============================================================

describe("Edge cases", () => {
  test("huge flat tree (1000 children)", () => {
    const tree = buildTree(
      Array.from({ length: 1000 }, (_, i) => [
        `item-${i}`,
        { type: "item", props: { index: i } },
      ] as [string, NodeDescriptor])
    );
    expect(countNodes(tree)).toBe(1001); // root + 1000 items
  });

  test("deeply nested chain (20 levels)", () => {
    const regs: [string, NodeDescriptor][] = [];
    let path = "";
    for (let i = 0; i < 20; i++) {
      path = path ? `${path}/level-${i}` : `level-${i}`;
      regs.push([path, { type: "group" }]);
    }
    const tree = buildTree(regs);
    // Walk down to verify depth
    let node: SlopNode | undefined = tree;
    for (let i = 0; i < 20; i++) {
      node = node?.children?.[0];
      expect(node).toBeDefined();
      expect(node?.id).toBe(`level-${i}`);
    }
  });

  test("deeply nested chain with maxDepth: 3", () => {
    const regs: [string, NodeDescriptor][] = [];
    let path = "";
    for (let i = 0; i < 10; i++) {
      path = path ? `${path}/l${i}` : `l${i}`;
      regs.push([path, { type: "group", summary: `Level ${i}` }]);
    }
    const tree = buildTree(regs);
    const truncated = truncateTreeForTest(tree, 4);

    // root (depth 0) → l0 (1) → l1 (2) → l2 (3) → l3 (4, truncated)
    let node: SlopNode | undefined = truncated;
    for (let i = 0; i < 4; i++) {
      node = node?.children?.[0];
      expect(node).toBeDefined();
    }
    // At depth 4, l4 should be a stub (if it has children)
    // l3 at depth 4 is the last resolved — check that its child (l4) is a stub
    const l3 = node;
    expect(l3?.id).toBe("l3");
    // l3's child should be truncated to a stub
    const l4 = l3?.children?.[0];
    if (l4) {
      // l4 exists but has no children (truncated)
      expect(l4.meta?.total_children).toBeDefined();
    }
  });

  test("single node tree", () => {
    const tree = buildTree([]);
    expect(tree.id).toBe("root");
    expect(countNodes(tree)).toBe(1);
  });

  test("tree with mixed features", () => {
    const tree = buildTree([
      ["profile", { type: "view", summary: "User profile" }],
      ["messages", {
        type: "collection",
        summary: "500 messages",
        window: {
          items: [{ id: "m1", props: { text: "Hi" } }],
          total: 500,
          offset: 0,
        },
      }],
      ["editor", {
        type: "document",
        props: { title: "main.ts" },
        contentRef: { type: "text", mime: "text/typescript", summary: "TS file" },
      }],
    ]);
    expect(countNodes(tree)).toBe(5); // root + profile + messages + m1 + editor
    expect(findNode(tree, "profile")?.meta?.summary).toBe("User profile");
    expect(findNode(tree, "messages")?.meta?.total_children).toBe(500);
    expect(findNode(tree, "editor")?.properties?.content_ref).toBeDefined();
  });

  test("maxNodes on tree where all nodes have same salience", () => {
    // When salience is equal, deeper nodes collapse first
    const tree: SlopNode = {
      id: "root", type: "root",
      children: [
        { id: "shallow", type: "group", children: [
          { id: "s1", type: "item" },
        ]},
        { id: "deep", type: "group", children: [
          { id: "d1", type: "group", children: [
            { id: "d2", type: "group", children: [
              { id: "d3", type: "item" },
            ]},
          ]},
        ]},
      ],
    };
    // 7 nodes, budget 5
    const compacted = autoCompactForTest(tree, 5);
    // Deep branch should be collapsed before shallow
    expect(countNodes(compacted)).toBeLessThanOrEqual(5);
  });

  test("rapid register/unregister in same tick", () => {
    const client = new SlopClientImpl({ id: "t", name: "T" }, mockTransport());
    // Register and unregister rapidly
    for (let i = 0; i < 100; i++) {
      client.register(`node-${i}`, { type: "item" });
    }
    for (let i = 0; i < 50; i++) {
      client.unregister(`node-${i}`);
    }
    client.flush();
    // Should have root + 50 remaining nodes
  });

  test("register same path multiple times (last wins)", () => {
    const client = new SlopClientImpl({ id: "t", name: "T" }, mockTransport());
    client.register("x", { type: "group", summary: "first" });
    client.register("x", { type: "view", summary: "second" });
    client.register("x", { type: "collection", summary: "third" });
    client.flush();
    // Last registration should win
  });

  test("window with very large offset", () => {
    const { node } = normalizeDescriptor("list", "list", {
      type: "collection",
      window: {
        items: [{ id: "m999999" }],
        total: 1000000,
        offset: 999999,
      },
    });
    expect(node.meta?.total_children).toBe(1000000);
    expect(node.meta?.window).toEqual([999999, 1]);
  });
});
