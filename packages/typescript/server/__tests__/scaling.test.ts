import { describe, test, expect, beforeEach } from "bun:test";
import { SlopServer } from "../src/server";
import type { Connection } from "../src/server";

// --- Mock Connection ---

class MockConnection implements Connection {
  messages: any[] = [];
  closed = false;

  send(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }

  findByType(type: string) {
    return this.messages.filter((m) => m.type === type);
  }

  lastSnapshot(): any {
    return [...this.messages].reverse().find((m) => m.type === "snapshot");
  }
}

function countNodes(node: any): number {
  return 1 + (node.children?.reduce((s: number, c: any) => s + countNodes(c), 0) ?? 0);
}

// ============================================================
// Server scaling integration tests
// ============================================================

describe("SlopServer scaling", () => {
  test("subscribe respects depth", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("a", { type: "view" });
    slop.register("a/b", () => ({ type: "collection" }));
    slop.register("a/b/c", () => ({ type: "item", props: { deep: true } }));

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, { type: "subscribe", id: "sub-1", path: "/", depth: 1 });

    const snapshot = conn.lastSnapshot();
    const a = snapshot.tree.children?.find((c: any) => c.id === "a");
    expect(a).toBeDefined();
    // At depth 1, a's children should be truncated
    expect(a.children).toBeUndefined();
    expect(a.meta?.total_children).toBe(1);
  });

  test("subscribe respects min_salience filter", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("alert", { type: "notification", meta: { salience: 1.0 } });
    slop.register("noise", { type: "item", meta: { salience: 0.1 } });

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, {
      type: "subscribe",
      id: "sub-1",
      filter: { min_salience: 0.5 },
    });

    const snapshot = conn.lastSnapshot();
    const ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("alert");
    expect(ids).not.toContain("noise");
  });

  test("subscribe respects types filter", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("alert", { type: "notification" });
    slop.register("data", { type: "collection" });

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, {
      type: "subscribe",
      id: "sub-1",
      filter: { types: ["notification"] },
    });

    const snapshot = conn.lastSnapshot();
    const ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("alert");
    expect(ids).not.toContain("data");
  });

  test("subscribe to subtree path", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("inbox", { type: "view", props: { label: "Inbox" } });
    slop.register("inbox/messages", () => ({
      type: "collection",
      items: [{ id: "m1", props: { text: "hello" } }],
    }));
    slop.register("settings", { type: "view" });

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, { type: "subscribe", id: "sub-1", path: "/inbox" });

    const snapshot = conn.lastSnapshot();
    expect(snapshot.tree.id).toBe("inbox");
    expect(snapshot.tree.children?.[0]?.id).toBe("messages");
  });

  test("query respects depth and filter", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("a", { type: "view", meta: { salience: 0.9 } });
    slop.register("a/b", () => ({ type: "item" }));
    slop.register("noise", { type: "item", meta: { salience: 0.1 } });

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, {
      type: "query",
      id: "q-1",
      depth: 1,
      filter: { min_salience: 0.5 },
    });

    const snapshot = conn.findByType("snapshot").find((m: any) => m.id === "q-1");
    const ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("a");
    expect(ids).not.toContain("noise");
    // a's children truncated at depth 1
    const a = snapshot.tree.children?.find((c: any) => c.id === "a");
    expect(a?.children).toBeUndefined();
  });

  test("maxNodes from server options applies to all output", () => {
    const slop = new SlopServer({ id: "app", name: "App", maxNodes: 5 });
    slop.register("data", () => ({
      type: "view",
      children: {
        list: {
          type: "collection",
          items: Array.from({ length: 20 }, (_, i) => ({
            id: `item-${i}`,
            props: { n: i },
          })),
        },
      },
    }));

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, { type: "subscribe", id: "sub-1" });

    const snapshot = conn.lastSnapshot();
    expect(countNodes(snapshot.tree)).toBeLessThanOrEqual(5);
  });

  test("broadcast sends per-subscription filtered trees", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("high", { type: "item", meta: { salience: 0.9 }, props: { v: 1 } });
    slop.register("low", { type: "item", meta: { salience: 0.1 } });

    const connAll = new MockConnection();
    const connFiltered = new MockConnection();
    slop.handleConnection(connAll);
    slop.handleConnection(connFiltered);
    slop.handleMessage(connAll, { type: "subscribe", id: "all" });
    slop.handleMessage(connFiltered, {
      type: "subscribe",
      id: "filtered",
      filter: { min_salience: 0.5 },
    });

    // Trigger a change
    slop.register("high", { type: "item", meta: { salience: 0.9 }, props: { v: 2 } });

    // connAll should see both
    const allSnapshot = connAll.lastSnapshot();
    const allIds = allSnapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(allIds).toContain("low");
    expect(allIds).toContain("high");

    // connFiltered should only see high
    const filteredSnapshot = connFiltered.lastSnapshot();
    const filteredIds = filteredSnapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(filteredIds).toContain("high");
    expect(filteredIds).not.toContain("low");
  });

  test("descriptor functions + scaling work together", () => {
    let count = 0;
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("counter", () => ({
      type: "status",
      props: { count },
      summary: `Count is ${count}`,
      meta: { salience: count > 0 ? 1.0 : 0.1 },
    }));

    const conn = new MockConnection();
    slop.handleConnection(conn);
    slop.handleMessage(conn, {
      type: "subscribe",
      id: "sub-1",
      filter: { min_salience: 0.5 },
    });

    // Initially count=0, salience=0.1 → filtered out
    let snapshot = conn.lastSnapshot();
    let ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).not.toContain("counter");

    // After mutation, count=1, salience=1.0 → now visible
    count = 1;
    slop.refresh();

    snapshot = conn.lastSnapshot();
    ids = snapshot.tree.children?.map((c: any) => c.id) ?? [];
    expect(ids).toContain("counter");
    expect(snapshot.tree.children.find((c: any) => c.id === "counter").meta.summary).toBe(
      "Count is 1"
    );
  });
});
