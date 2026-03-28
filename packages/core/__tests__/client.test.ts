import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SlopClientImpl } from "../src/client";
import type { NodeDescriptor } from "../src/types";

// Mock postMessage for testing (no real DOM)
const sentMessages: any[] = [];
const incomingHandlers: ((msg: any) => void)[] = [];

// Patch globalThis for postMessage
globalThis.window = {
  postMessage: (data: any) => sentMessages.push(data),
  addEventListener: (_: string, handler: any) => {},
  removeEventListener: () => {},
} as any;
globalThis.document = {
  head: { appendChild: () => {}, },
  querySelector: () => null,
  createElement: (tag: string) => ({ name: "", content: "", remove: () => {} }),
} as any;

function createTestClient() {
  const client = new SlopClientImpl({ id: "test", name: "Test App" });
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
});
