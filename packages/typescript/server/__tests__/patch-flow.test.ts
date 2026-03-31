import { describe, test, expect } from "bun:test";
import { SlopServer } from "../src/server";
import type { Connection } from "../src/server";
import { StateMirror } from "../../consumer/src/state-mirror";

class MockConnection implements Connection {
  messages: any[] = [];
  closed = false;
  send(message: unknown): void { this.messages.push(message); }
  close(): void { this.closed = true; }
}

function setup() {
  const slop = new SlopServer({ id: "app", name: "App" });
  const conn = new MockConnection();
  slop.handleConnection(conn);
  return { slop, conn };
}

function subscribe(slop: SlopServer, conn: MockConnection, opts: any = {}) {
  slop.handleMessage(conn, { type: "subscribe", id: opts.id ?? "sub-1", path: opts.path ?? "/", depth: opts.depth, filter: opts.filter });
  return conn.messages.find(m => m.type === "snapshot" && m.id === (opts.id ?? "sub-1"));
}

function lastPatch(conn: MockConnection, subId = "sub-1") {
  return [...conn.messages].reverse().find(m => m.type === "patch" && m.subscription === subId);
}

function replayState(conn: MockConnection): StateMirror | null {
  let mirror: StateMirror | null = null;
  for (const msg of conn.messages) {
    if (msg.type === "snapshot") mirror = new StateMirror(msg);
    else if (msg.type === "patch" && mirror) mirror.applyPatch(msg);
  }
  return mirror;
}

describe("Patch message flow", () => {
  test("initial subscribe sends snapshot, not patch", () => {
    const { slop, conn } = setup();
    slop.register("counter", { type: "status", props: { count: 0 } });
    subscribe(slop, conn);

    const snapshots = conn.messages.filter(m => m.type === "snapshot");
    const patches = conn.messages.filter(m => m.type === "patch");
    expect(snapshots.length).toBe(1);
    expect(patches.length).toBe(0);
  });

  test("state change sends patch with correct ops", () => {
    const { slop, conn } = setup();
    slop.register("counter", { type: "status", props: { count: 0 } });
    subscribe(slop, conn);

    // Mutate
    slop.register("counter", { type: "status", props: { count: 1 } });

    const patch = lastPatch(conn);
    expect(patch).toBeDefined();
    expect(patch.type).toBe("patch");
    expect(patch.subscription).toBe("sub-1");
    expect(patch.version).toBe(2);
    expect(patch.ops.length).toBeGreaterThan(0);

    const replaceOp = patch.ops.find((o: any) => o.op === "replace" && o.path.includes("properties/count"));
    expect(replaceOp).toBeDefined();
    expect(replaceOp.value).toBe(1);
  });

  test("patch paths use spec-compliant ID-based format", () => {
    const { slop, conn } = setup();
    slop.register("inbox", { type: "collection", props: { label: "Inbox" } });
    subscribe(slop, conn);

    slop.register("inbox", { type: "collection", props: { label: "Inbox (2)" } });

    const patch = lastPatch(conn);
    const op = patch.ops[0];
    // Path should be /inbox/properties/label, NOT /children/inbox/properties/label
    expect(op.path).toBe("/inbox/properties/label");
    expect(op.value).toBe("Inbox (2)");
  });

  test("adding a child generates add op", () => {
    const { slop, conn } = setup();
    slop.register("todos", { type: "collection", props: {} });
    subscribe(slop, conn);

    slop.register("todos/t1", { type: "item", props: { title: "First" } });

    const patch = lastPatch(conn);
    const addOp = patch.ops.find((o: any) => o.op === "add" && o.path === "/todos/t1");
    expect(addOp).toBeDefined();
    expect(addOp.value.id).toBe("t1");
    expect(addOp.value.properties.title).toBe("First");
  });

  test("removing a child generates remove op", () => {
    const { slop, conn } = setup();
    slop.register("todos", { type: "collection", props: {} });
    slop.register("todos/t1", { type: "item", props: { title: "First" } });
    subscribe(slop, conn);

    slop.unregister("todos/t1");

    const patch = lastPatch(conn);
    const removeOp = patch.ops.find((o: any) => o.op === "remove" && o.path === "/todos/t1");
    expect(removeOp).toBeDefined();
  });

  test("consumer state mirror stays in sync via patches", () => {
    const { slop, conn } = setup();
    slop.register("counter", { type: "status", props: { count: 0 } });
    subscribe(slop, conn);

    // Multiple mutations
    slop.register("counter", { type: "status", props: { count: 1 } });
    slop.register("counter", { type: "status", props: { count: 2, label: "Counter" } });
    slop.register("tasks", { type: "collection", props: {} });
    slop.register("tasks/t1", { type: "item", props: { title: "Do stuff" } });

    // Replay all messages through StateMirror
    const mirror = replayState(conn)!;
    expect(mirror).not.toBeNull();

    const tree = mirror.getTree();
    const counter = tree.children?.find(c => c.id === "counter");
    expect(counter?.properties?.count).toBe(2);
    expect(counter?.properties?.label).toBe("Counter");

    const tasks = tree.children?.find(c => c.id === "tasks");
    expect(tasks).toBeDefined();
    const t1 = tasks?.children?.find(c => c.id === "t1");
    expect(t1?.properties?.title).toBe("Do stuff");
  });

  test("version increments with each patch", () => {
    const { slop, conn } = setup();
    slop.register("x", { type: "status", props: { v: 0 } });
    subscribe(slop, conn);

    const snapshot = conn.messages.find(m => m.type === "snapshot");
    expect(snapshot.version).toBe(1);

    slop.register("x", { type: "status", props: { v: 1 } });
    expect(lastPatch(conn).version).toBe(2);

    slop.register("x", { type: "status", props: { v: 2 } });
    expect(lastPatch(conn).version).toBe(3);
  });

  test("no patch sent when state does not change", () => {
    const { slop, conn } = setup();
    slop.register("x", { type: "status", props: { v: 1 } });
    subscribe(slop, conn);

    const countBefore = conn.messages.length;
    // Re-register with same value
    slop.register("x", { type: "status", props: { v: 1 } });

    expect(conn.messages.length).toBe(countBefore);
  });

  test("multiple subscriptions get independent patches", () => {
    const slop = new SlopServer({ id: "app", name: "App" });
    slop.register("data", { type: "status", props: { v: 0 } });

    const conn1 = new MockConnection();
    const conn2 = new MockConnection();
    slop.handleConnection(conn1);
    slop.handleConnection(conn2);

    subscribe(slop, conn1, { id: "s1" });
    subscribe(slop, conn2, { id: "s2" });

    slop.register("data", { type: "status", props: { v: 1 } });

    const p1 = lastPatch(conn1, "s1");
    const p2 = lastPatch(conn2, "s2");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1.subscription).toBe("s1");
    expect(p2.subscription).toBe("s2");
  });

  test("nested property change produces correct deep path", () => {
    const { slop, conn } = setup();
    slop.register("editor", { type: "view", props: {} });
    slop.register("editor/file", { type: "document", props: { name: "main.ts", dirty: false } });
    subscribe(slop, conn);

    slop.register("editor/file", { type: "document", props: { name: "main.ts", dirty: true } });

    const patch = lastPatch(conn);
    const op = patch.ops.find((o: any) => o.path === "/editor/file/properties/dirty");
    expect(op).toBeDefined();
    expect(op.op).toBe("replace");
    expect(op.value).toBe(true);
  });
});
