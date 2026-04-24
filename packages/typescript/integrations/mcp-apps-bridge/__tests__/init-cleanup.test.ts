import { describe, expect, test } from "bun:test";
import { connectBoth, type DisposableApp, type DisposableConsumer } from "../src/init-cleanup";

interface Spy<T> {
  value: T;
  calls: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeConsumer(connect: () => Promise<unknown>): DisposableConsumer & {
  disconnects: Spy<number>;
} {
  const disconnects: Spy<number> = { value: 0, calls: 0 };
  return {
    connect,
    disconnect() {
      disconnects.value += 1;
      disconnects.calls += 1;
    },
    disconnects,
  };
}

function makeApp(connect: () => Promise<unknown>): DisposableApp & {
  closes: Spy<number>;
} {
  const closes: Spy<number> = { value: 0, calls: 0 };
  return {
    connect,
    async close() {
      closes.value += 1;
      closes.calls += 1;
    },
    closes,
  };
}

describe("connectBoth", () => {
  test("resolves when both connects succeed; nothing torn down", async () => {
    const c = makeConsumer(() => Promise.resolve());
    const a = makeApp(() => Promise.resolve());
    await connectBoth(c, a);
    expect(c.disconnects.value).toBe(0);
    expect(a.closes.value).toBe(0);
  });

  test("consumer rejects fast; later-resolving app is torn down (the race)", async () => {
    const appGate = deferred<void>();
    const c = makeConsumer(() => Promise.reject(new Error("ws refused")));
    const a = makeApp(() => appGate.promise);

    const init = connectBoth(c, a);
    // Resolve the app side AFTER consumer rejection has propagated.
    queueMicrotask(() => appGate.resolve());

    await expect(init).rejects.toThrow("ws refused");
    // The late-successful app must close itself, not leak.
    expect(a.closes.value).toBe(1);
    expect(c.disconnects.value).toBe(0);
  });

  test("app rejects fast; later-resolving consumer is torn down", async () => {
    const consumerGate = deferred<void>();
    const c = makeConsumer(() => consumerGate.promise);
    const a = makeApp(() => Promise.reject(new Error("ext-apps init failed")));

    const init = connectBoth(c, a);
    queueMicrotask(() => consumerGate.resolve());

    await expect(init).rejects.toThrow("ext-apps init failed");
    expect(c.disconnects.value).toBe(1);
    expect(a.closes.value).toBe(0);
  });

  test("both reject; nothing to tear down", async () => {
    const c = makeConsumer(() => Promise.reject(new Error("a")));
    const a = makeApp(() => Promise.reject(new Error("b")));
    await expect(connectBoth(c, a)).rejects.toBeDefined();
    expect(c.disconnects.value).toBe(0);
    expect(a.closes.value).toBe(0);
  });

  test("consumer fails after app already connected; app is torn down", async () => {
    const consumerGate = deferred<void>();
    const c = makeConsumer(() => consumerGate.promise);
    const a = makeApp(() => Promise.resolve());

    const init = connectBoth(c, a);
    // Let the app's resolution + flag flip propagate, then fail the consumer.
    await Promise.resolve();
    consumerGate.reject(new Error("late ws fail"));

    await expect(init).rejects.toThrow("late ws fail");
    // App connected before consumer failed → catch handler tears it down.
    expect(a.closes.value).toBe(1);
  });
});
