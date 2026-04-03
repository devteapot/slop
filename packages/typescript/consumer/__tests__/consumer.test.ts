import { describe, test, expect } from "bun:test";
import { SlopConsumer } from "../src/consumer";
import type { SlopMessage, ProviderMessage } from "../src/types";

/** Minimal in-memory transport for testing the consumer. */
function mockTransport() {
  let handler: ((msg: SlopMessage) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  const sent: SlopMessage[] = [];

  const transport = {
    connect: () =>
      Promise.resolve({
        send(msg: SlopMessage) { sent.push(msg); },
        onMessage(fn: (msg: SlopMessage) => void) { handler = fn; },
        onClose(fn: () => void) { closeHandler = fn; },
        close() { closeHandler?.(); },
      }),
  };

  /** Simulate a message from the provider to the consumer. */
  function inject(msg: ProviderMessage) {
    handler?.(msg as SlopMessage);
  }

  return { transport, sent, inject };
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function setupConsumer() {
  const { transport, sent, inject } = mockTransport();
  const consumer = new SlopConsumer(transport);

  // Start connect (will wait for hello)
  const helloPromise = consumer.connect();
  // Wait a tick so the onMessage handler is registered
  await tick();
  // Inject hello to unblock
  inject({
    type: "hello",
    provider: { id: "test", name: "Test", slop_version: "0.1", capabilities: [] },
  });
  await helloPromise;

  return { consumer, sent, inject };
}

describe("SlopConsumer protocol gaps", () => {
  test("error message rejects pending subscribe", async () => {
    const { consumer, inject } = await setupConsumer();

    const subPromise = consumer.subscribe("/missing", 1);
    // Simulate server sending an error for this subscription
    inject({
      type: "error",
      id: "sub-1",
      error: { code: "not_found", message: "Path /missing not found" },
    });

    await expect(subPromise).rejects.toEqual({
      code: "not_found",
      message: "Path /missing not found",
    });
  });

  test("error message rejects pending query", async () => {
    const { consumer, inject } = await setupConsumer();

    const queryPromise = consumer.query("/bad");
    inject({
      type: "error",
      id: "q-1",
      error: { code: "not_found", message: "Path /bad not found" },
    });

    await expect(queryPromise).rejects.toEqual({
      code: "not_found",
      message: "Path /bad not found",
    });
  });

  test("error message fires onError callback", async () => {
    const { consumer, inject } = await setupConsumer();

    const errors: any[] = [];
    consumer.onError((error, id) => errors.push({ error, id }));

    inject({
      type: "error",
      id: "sub-1",
      error: { code: "bad_request", message: "Something went wrong" },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].error.code).toBe("bad_request");
    expect(errors[0].id).toBe("sub-1");
  });

  test("onError returns unsubscribe function", async () => {
    const { consumer, inject } = await setupConsumer();

    const errors: any[] = [];
    const unsub = consumer.onError((error) => errors.push(error));

    inject({ type: "error", error: { code: "internal", message: "oops" } });
    expect(errors).toHaveLength(1);

    unsub();
    inject({ type: "error", error: { code: "internal", message: "again" } });
    expect(errors).toHaveLength(1); // no new error after unsub
  });

  test("event message fires onEvent callback", async () => {
    const { consumer, inject } = await setupConsumer();

    const events: any[] = [];
    consumer.onEvent((name, data) => events.push({ name, data }));

    inject({
      type: "event",
      name: "user-navigation",
      data: { from: "/a", to: "/b" },
    });

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("user-navigation");
    expect(events[0].data).toEqual({ from: "/a", to: "/b" });
  });

  test("onEvent returns unsubscribe function", async () => {
    const { consumer, inject } = await setupConsumer();

    const events: any[] = [];
    const unsub = consumer.onEvent((name) => events.push(name));

    inject({ type: "event", name: "evt1" });
    expect(events).toHaveLength(1);

    unsub();
    inject({ type: "event", name: "evt2" });
    expect(events).toHaveLength(1);
  });

  test("batch message unwraps and processes inner messages", async () => {
    const { consumer, inject } = await setupConsumer();

    // Subscribe first to get a mirror
    const subPromise = consumer.subscribe("/", -1);
    inject({
      type: "snapshot",
      id: "sub-1",
      version: 1,
      tree: { id: "root", type: "root", children: [{ id: "a", type: "item", properties: { v: 0 } }] },
    });
    await subPromise;

    const events: any[] = [];
    consumer.onEvent((name, data) => events.push({ name, data }));

    // Send a batch containing a patch and an event
    inject({
      type: "batch",
      messages: [
        {
          type: "patch",
          subscription: "sub-1",
          version: 2,
          ops: [{ op: "replace", path: "/a/properties/v", value: 42 }],
        },
        {
          type: "event",
          name: "batch-event",
          data: { key: "val" },
        },
      ],
    });

    // The patch should have been applied
    const tree = consumer.getTree("sub-1");
    expect(tree).not.toBeNull();
    expect(tree!.children![0].properties?.v).toBe(42);

    // The event should have fired
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("batch-event");
  });
});
