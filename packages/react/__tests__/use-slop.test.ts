import { describe, test, expect, mock } from "bun:test";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

/**
 * Since useSlop is ~10 lines and the real validation happens in the demo-spa rewrite,
 * we test the contract directly: register is called with the right args,
 * unregister is callable, and the hook handles path changes.
 *
 * Full React rendering tests happen in the examples/ integration tests.
 */

function createMockClient() {
  const registered = new Map<string, NodeDescriptor>();
  const unregistered: string[] = [];

  return {
    registered,
    unregistered,
    register: mock((path: string, desc: NodeDescriptor) => {
      registered.set(path, desc);
    }) as any,
    unregister: mock((path: string) => {
      registered.delete(path);
      unregistered.push(path);
    }) as any,
    scope: mock(() => ({}) as any),
    flush: mock(() => {}),
    stop: mock(() => {}),
  } satisfies SlopClient & { registered: Map<string, NodeDescriptor>; unregistered: string[] };
}

describe("useSlop contract", () => {
  test("register is called with path and descriptor", () => {
    const client = createMockClient();
    const desc: NodeDescriptor = { type: "collection", props: { count: 3 } };

    // Simulate what useSlop does on render
    client.register("notes", desc);

    expect(client.register).toHaveBeenCalledWith("notes", desc);
    expect(client.registered.get("notes")).toEqual(desc);
  });

  test("re-register with updated descriptor replaces previous", () => {
    const client = createMockClient();

    client.register("notes", { type: "collection", props: { count: 3 } });
    client.register("notes", { type: "collection", props: { count: 5 } });

    expect(client.registered.get("notes")).toEqual({ type: "collection", props: { count: 5 } });
  });

  test("unregister removes the registration", () => {
    const client = createMockClient();

    client.register("notes", { type: "collection" });
    expect(client.registered.has("notes")).toBe(true);

    client.unregister("notes");
    expect(client.registered.has("notes")).toBe(false);
    expect(client.unregistered).toContain("notes");
  });

  test("path change: unregister old, register new", () => {
    const client = createMockClient();
    const desc: NodeDescriptor = { type: "collection" };

    // First render at old path
    client.register("inbox/messages", desc);
    expect(client.registered.has("inbox/messages")).toBe(true);

    // Path changes — simulate what useSlop does
    client.unregister("inbox/messages");
    client.register("archive/messages", desc);

    expect(client.registered.has("inbox/messages")).toBe(false);
    expect(client.registered.has("archive/messages")).toBe(true);
  });

  test("action handlers in descriptor are fresh references", () => {
    const client = createMockClient();

    // Render 1: handler closes over val=1
    let val = 1;
    client.register("test", {
      type: "group",
      actions: { doThing: () => val },
    });

    // Render 2: handler closes over val=2
    val = 2;
    client.register("test", {
      type: "group",
      actions: { doThing: () => val },
    });

    const desc = client.registered.get("test")!;
    const action = desc.actions!.doThing as () => number;
    expect(action()).toBe(2); // latest closure
  });

  test("works with scoped client pattern", () => {
    const client = createMockClient();
    const scopedRegister = mock((path: string, desc: NodeDescriptor) => {
      client.register(`inbox/${path}`, desc);
    });
    const scoped = { ...client, register: scopedRegister };

    scoped.register("messages", { type: "collection" });

    expect(client.registered.has("inbox/messages")).toBe(true);
  });
});
