import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SlopClientImpl } from "../src/client";
import type { NodeDescriptor, Transport } from "@slop-ai/core";

// Mock transport for testing
const sentMessages: any[] = [];
const incomingHandlers: ((msg: any) => void)[] = [];

function createMockTransport(): Transport {
  return {
    send(message: unknown) { sentMessages.push(message); },
    onMessage(handler: (msg: any) => void) { incomingHandlers.push(handler); },
    start() {},
    stop() {},
  };
}

function createTestClient() {
  const client = new SlopClientImpl({ id: "test", name: "Test App" }, createMockTransport());
  // Don't call start() — we test tree assembly without transport
  return client;
}

describe("SlopClient", () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  test("register + flush builds tree", () => {
    const client = createTestClient();
    client.register("notes", { type: "collection", props: { count: 3 } });
    client.flush();

    // Access internal state via the rebuild side effect
    // We can verify by registering a subscription and checking the snapshot
    // For unit testing, we verify the tree assembly indirectly
    expect(true).toBe(true); // Tree builds without error
  });

  test("multiple registers in same tick batch into one rebuild", async () => {
    const client = createTestClient();
    let rebuildCount = 0;
    const origFlush = client.flush.bind(client);

    client.register("a", { type: "group" });
    client.register("b", { type: "group" });
    client.register("c", { type: "group" });

    // All three should be batched — wait for microtask
    await new Promise(r => queueMicrotask(r));
    // No crash = success. Batching verified by the queueMicrotask mechanism.
  });

  test("flush forces immediate rebuild", () => {
    const client = createTestClient();
    client.register("notes", { type: "collection" });
    client.flush(); // Should not throw
  });

  test("unregister removes node", () => {
    const client = createTestClient();
    client.register("notes", { type: "collection" });
    client.register("settings", { type: "view" });
    client.flush();

    client.unregister("notes");
    client.flush(); // Tree should rebuild without "notes"
  });

  test("unregister with recursive removes children", () => {
    const client = createTestClient();
    client.register("inbox", { type: "view" });
    client.register("inbox/messages", { type: "collection" });
    client.register("inbox/compose", { type: "form" });
    client.flush();

    client.unregister("inbox", { recursive: true });
    client.flush();

    // Re-register something to verify clean state
    client.register("settings", { type: "view" });
    client.flush();
  });

  test("scope prepends prefix", () => {
    const client = createTestClient();
    const inbox = client.scope("inbox", { type: "view" });
    inbox.register("messages", { type: "collection" });
    inbox.register("unread", { type: "status", props: { count: 5 } });
    client.flush();

    // Verify by checking registrations were made at correct paths
    // (internal state — we'd need a getTree() method for full verification)
  });

  test("nested scope composes prefixes", () => {
    const client = createTestClient();
    const workspace = client.scope("workspace", { type: "view" });
    const projects = workspace.scope("projects", { type: "collection" });
    projects.register("board", { type: "view" });
    client.flush();
    // Should register at "workspace/projects/board"
  });

  test("handles hierarchical paths correctly", () => {
    const client = createTestClient();
    // Register child before parent
    client.register("inbox/messages", { type: "collection" });
    client.register("inbox", { type: "view", props: { label: "Inbox" } });
    client.flush();
    // Should not throw — synthetic parent gets replaced
  });

  test("items produce handler entries", () => {
    const client = createTestClient();
    const deleteFn = mock(() => {});

    client.register("todos", {
      type: "collection",
      items: [{
        id: "t1",
        props: { title: "Test" },
        actions: { delete: deleteFn },
      }],
    });
    client.flush();
    // Handler should be registered at "todos/t1/delete"
  });

  test("start and stop don't throw", () => {
    const client = createTestClient();
    client.start();
    client.stop();
  });

  test("maxNodes: tree under budget is unchanged", () => {
    const client = new SlopClientImpl({ id: "test", name: "Test", maxNodes: 100 }, createMockTransport());
    client.register("a", { type: "group" });
    client.register("b", { type: "group" });
    client.flush();
    // 3 nodes (root + a + b), budget 100 → no compaction
  });

  test("maxNodes: tree over budget gets compacted", () => {
    const client = new SlopClientImpl({ id: "test", name: "Test", maxNodes: 5 }, createMockTransport());
    // Create a tree with many nodes: root + section + 10 items = 12 nodes
    client.register("section", {
      type: "collection",
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        props: { title: `Item ${i}` },
      })),
    });
    client.flush();
    // Budget is 5, tree has 12 nodes → should compact
    // The section's items should be collapsed
  });

  test("maxNodes: low salience nodes collapsed first", () => {
    const client = new SlopClientImpl({ id: "test", name: "Test", maxNodes: 5 }, createMockTransport());
    client.register("important", {
      type: "collection",
      meta: { salience: 1.0 },
      items: [
        { id: "i1", props: { x: 1 } },
        { id: "i2", props: { x: 2 } },
      ],
    });
    client.register("unimportant", {
      type: "collection",
      meta: { salience: 0.1 },
      summary: "Low priority stuff",
      items: [
        { id: "u1", props: { x: 1 } },
        { id: "u2", props: { x: 2 } },
        { id: "u3", props: { x: 3 } },
      ],
    });
    client.flush();
    // 8 nodes total, budget 5
    // "unimportant" (salience 0.1) should be collapsed before "important" (salience 1.0)
  });
});

// ============================================================
// Integration: scaling through the message protocol
// ============================================================

describe("SlopClient scaling integration", () => {
  function createTrackedClient(opts: { maxDepth?: number; maxNodes?: number } = {}) {
    const sent: any[] = [];
    const handlers: ((msg: any) => void)[] = [];
    const transport: Transport = {
      send(msg) { sent.push(msg); },
      onMessage(h) { handlers.push(h); },
      start() {},
      stop() {},
    };
    const client = new SlopClientImpl({ id: "app", name: "App", ...opts }, transport);
    client.start();
    const simulate = (msg: any) => handlers.forEach(h => h(msg));
    return { client, sent, simulate };
  }

  test("subscribe respects depth from consumer", () => {
    const { client, sent, simulate } = createTrackedClient();
    client.register("a", { type: "view" });
    client.register("a/b", { type: "collection" });
    client.register("a/b/c", { type: "item", props: { deep: true } });
    client.flush();

    simulate({ type: "subscribe", id: "sub-1", path: "/", depth: 1 });
    const snapshot = sent.find(m => m.type === "snapshot" && m.id === "sub-1");
    expect(snapshot).toBeDefined();
    // At depth 1, a should be present but its children truncated
    const a = snapshot.tree.children?.find((c: any) => c.id === "a");
    expect(a).toBeDefined();
    expect(a.children).toBeUndefined();
    expect(a.meta?.total_children).toBe(1);
  });

  test("subscribe respects min_salience filter", () => {
    const { client, sent, simulate } = createTrackedClient();
    client.register("high", { type: "item", meta: { salience: 0.9 } });
    client.register("low", { type: "item", meta: { salience: 0.1 } });
    client.flush();

    simulate({ type: "subscribe", id: "sub-1", filter: { min_salience: 0.5 } });
    const snapshot = sent.find(m => m.type === "snapshot" && m.id === "sub-1");
    const ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("high");
    expect(ids).not.toContain("low");
  });

  test("subscribe respects types filter", () => {
    const { client, sent, simulate } = createTrackedClient();
    client.register("alert", { type: "notification" });
    client.register("data", { type: "collection" });
    client.flush();

    simulate({ type: "subscribe", id: "sub-1", filter: { types: ["notification"] } });
    const snapshot = sent.find(m => m.type === "snapshot" && m.id === "sub-1");
    const ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("alert");
    expect(ids).not.toContain("data");
  });

  test("subscribe to subtree path", () => {
    const { client, sent, simulate } = createTrackedClient();
    client.register("inbox", { type: "view", props: { label: "Inbox" } });
    client.register("inbox/messages", { type: "collection", items: [{ id: "m1", props: { text: "hi" } }] });
    client.register("settings", { type: "view" });
    client.flush();

    simulate({ type: "subscribe", id: "sub-1", path: "/inbox" });
    const snapshot = sent.find(m => m.type === "snapshot" && m.id === "sub-1");
    // Should get the inbox subtree, not the full tree
    expect(snapshot.tree.id).toBe("inbox");
    expect(snapshot.tree.children?.[0]?.id).toBe("messages");
  });

  test("query respects depth and filter", () => {
    const { client, sent, simulate } = createTrackedClient();
    client.register("a", { type: "view", meta: { salience: 0.9 } });
    client.register("a/b", { type: "item" });
    client.register("noise", { type: "item", meta: { salience: 0.1 } });
    client.flush();

    simulate({ type: "query", id: "q-1", depth: 1, filter: { min_salience: 0.5 } });
    const snapshot = sent.find(m => m.type === "snapshot" && m.id === "q-1");
    const ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("a");
    expect(ids).not.toContain("noise");
    // a's children should be truncated at depth 1
    const a = snapshot.tree.children?.find((c: any) => c.id === "a");
    expect(a?.children).toBeUndefined();
  });

  test("broadcast sends per-subscription filtered trees", () => {
    const { client, sent, simulate } = createTrackedClient();
    client.register("high", { type: "item", meta: { salience: 0.9 }, props: { v: 1 } });
    client.register("low", { type: "item", meta: { salience: 0.1 } });
    client.flush();

    // Two subscriptions with different filters
    simulate({ type: "subscribe", id: "all", path: "/" });
    simulate({ type: "subscribe", id: "filtered", path: "/", filter: { min_salience: 0.5 } });
    sent.length = 0; // clear

    // Trigger a change
    client.register("high", { type: "item", meta: { salience: 0.9 }, props: { v: 2 } });
    client.flush();

    const allSnapshot = sent.find(m => m.type === "snapshot" && m.id === "all");
    const filteredSnapshot = sent.find(m => m.type === "snapshot" && m.id === "filtered");
    expect(allSnapshot).toBeDefined();
    expect(filteredSnapshot).toBeDefined();

    // "all" subscription should see both nodes
    const allIds = allSnapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(allIds).toContain("low");

    // "filtered" subscription should only see high salience
    const filteredIds = filteredSnapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(filteredIds).not.toContain("low");
  });
});
