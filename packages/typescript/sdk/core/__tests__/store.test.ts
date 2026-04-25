import { describe, expect, test } from "bun:test";
import { exposeStore, type NodeDescriptor, type StateStore, type StoreTarget } from "../src/index";

class TestStore<S> implements StateStore<S> {
  private listeners = new Set<() => void>();

  constructor(private state: S) {}

  getState(): S {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setState(next: S): void {
    this.state = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

function createTarget() {
  const registered = new Map<string, NodeDescriptor>();
  const unregistered: Array<{ path: string; opts?: { recursive?: boolean } }> = [];

  const target: StoreTarget & {
    registered: Map<string, NodeDescriptor>;
    unregistered: Array<{ path: string; opts?: { recursive?: boolean } }>;
  } = {
    registered,
    unregistered,
    register(path, descriptor) {
      registered.set(path, descriptor);
    },
    unregister(path, opts) {
      registered.delete(path);
      if (opts?.recursive) {
        const prefix = `${path}/`;
        for (const key of [...registered.keys()]) {
          if (key.startsWith(prefix)) registered.delete(key);
        }
      }
      unregistered.push({ path, opts });
    },
  };

  return target;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("exposeStore", () => {
  test("registers the initial store state and updates on store emissions", () => {
    const target = createTarget();
    const store = new TestStore({ count: 1 });

    exposeStore(target, "counter", store, (state) => ({
      type: "status",
      props: { count: state.count },
    }));

    expect(target.registered.get("counter")).toEqual({
      type: "status",
      props: { count: 1 },
    });

    store.setState({ count: 2 });

    expect(target.registered.get("counter")).toEqual({
      type: "status",
      props: { count: 2 },
    });
  });

  test("cleans up the subscription and unregisters recursively", () => {
    const target = createTarget();
    const store = new TestStore({ items: 1 });

    target.registered.set("list/item-1", { type: "item" });

    const cleanup = exposeStore(target, "list", store, (state) => ({
      type: "collection",
      props: { count: state.items },
    }));

    expect(store.listenerCount()).toBe(1);

    cleanup();

    expect(store.listenerCount()).toBe(0);
    expect(target.registered.has("list")).toBe(false);
    expect(target.registered.has("list/item-1")).toBe(false);
    expect(target.unregistered).toContainEqual({ path: "list", opts: { recursive: true } });

    store.setState({ items: 2 });
    expect(target.registered.has("list")).toBe(false);
  });

  test("unregisters the previous node when a dynamic path changes", () => {
    const target = createTarget();
    const store = new TestStore({ boardId: "board-1", cardCount: 3 });

    exposeStore(
      target,
      (state) => `boards/${state.boardId}`,
      store,
      (state) => ({
        type: "view",
        props: { card_count: state.cardCount },
      }),
    );

    expect(target.registered.has("boards/board-1")).toBe(true);

    store.setState({ boardId: "board-2", cardCount: 5 });

    expect(target.registered.has("boards/board-1")).toBe(false);
    expect(target.registered.get("boards/board-2")).toEqual({
      type: "view",
      props: { card_count: 5 },
    });
    expect(target.unregistered).toContainEqual({ path: "boards/board-1", opts: { recursive: true } });
  });

  test("skips projection work when equality reports no relevant change", () => {
    const target = createTarget();
    const store = new TestStore({ visible: 1, ignored: "a" });
    let projectCount = 0;

    exposeStore(
      target,
      "view",
      store,
      (state) => {
        projectCount++;
        return { type: "view", props: { visible: state.visible } };
      },
      { equals: (previous, next) => previous.visible === next.visible },
    );

    store.setState({ visible: 1, ignored: "b" });
    expect(projectCount).toBe(1);
    expect(target.registered.get("view")).toEqual({
      type: "view",
      props: { visible: 1 },
    });

    store.setState({ visible: 2, ignored: "b" });
    expect(projectCount).toBe(2);
    expect(target.registered.get("view")).toEqual({
      type: "view",
      props: { visible: 2 },
    });
  });

  test("debounces rapid store emissions before recomputing the descriptor", async () => {
    const target = createTarget();
    const store = new TestStore({ count: 0 });
    const projected: number[] = [];

    const cleanup = exposeStore(
      target,
      "counter",
      store,
      (state) => {
        projected.push(state.count);
        return { type: "status", props: { count: state.count } };
      },
      { debounceMs: 10 },
    );

    store.setState({ count: 1 });
    store.setState({ count: 2 });

    expect(projected).toEqual([0]);

    await sleep(20);

    expect(projected).toEqual([0, 2]);
    expect(target.registered.get("counter")).toEqual({
      type: "status",
      props: { count: 2 },
    });

    cleanup();
  });

  test("supports subscriptions with an unsubscribe method", () => {
    const target = createTarget();
    let unsubscribed = false;

    const store: StateStore<{ ready: boolean }> = {
      getState: () => ({ ready: true }),
      subscribe: () => ({
        unsubscribe() {
          unsubscribed = true;
        },
      }),
    };

    const cleanup = exposeStore(target, "status", store, (state) => ({
      type: "status",
      props: { ready: state.ready },
    }));

    cleanup();

    expect(unsubscribed).toBe(true);
  });
});
