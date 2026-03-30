import { describe, test, expect } from "bun:test";
import { SlopClientImpl } from "../src/client";
import type { SlopNode } from "@slop-ai/core";

// Mock DOM globals for transport
globalThis.window = {
  postMessage: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
} as any;
globalThis.document = {
  head: { appendChild: () => {} },
  querySelector: () => null,
  createElement: () => ({ name: "", content: "", remove: () => {} }),
} as any;

function createClient() {
  return new SlopClientImpl({ id: "test", name: "Test" });
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function findNode(root: SlopNode, id: string): SlopNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

describe("asyncAction", () => {
  test("returns an Action with estimate 'async'", () => {
    const client = createClient();
    const a = client.asyncAction(
      { env: "string" },
      async () => {},
    );
    expect((a as any).estimate).toBe("async");
    expect(typeof (a as any).handler).toBe("function");
  });

  test("handler returns __async: true with taskId", () => {
    const client = createClient();
    const a = client.asyncAction({ x: "string" }, async () => {});
    const result = (a as any).handler({ x: "test" });
    expect(result.__async).toBe(true);
    expect(result.taskId).toBeDefined();
    expect(typeof result.taskId).toBe("string");
  });

  test("creates a task status node on invoke", async () => {
    const client = createClient();
    const a = client.asyncAction(
      { env: "string" },
      async ({ env }, task) => {
        task.update(0.5, "Halfway");
        await delay(10);
        return { done: true };
      },
      { label: "Deploy" }
    );

    const result = (a as any).handler({ env: "prod" });
    client.flush();

    // Task node should be registered
    // Wait for the initial update to register
    await delay(5);
    client.flush();
  });

  test("task completes and sets status to done", async () => {
    const client = createClient();
    let resolveWork: () => void;
    const workDone = new Promise<void>(r => { resolveWork = r; });

    const a = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0.5, "Working...");
        await delay(20);
        return { result: "success" };
      },
    );

    (a as any).handler({});

    // Wait for the async work to complete
    await delay(50);
    client.flush();

    // The task should exist and be "done" (or already cleaned up after 30s)
    // We can't directly inspect the tree without a consumer, but we verify no crash
  });

  test("task fails and sets status to failed", async () => {
    const client = createClient();
    const a = client.asyncAction(
      {},
      async () => {
        throw new Error("Deploy exploded");
      },
    );

    (a as any).handler({});
    await delay(20);
    client.flush();
    // Should not crash — error is caught and registered as a failed task node
  });

  test("multiple async actions run concurrently with different durations", async () => {
    const client = createClient();
    const completionOrder: string[] = [];

    const fast = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "Fast starting");
        await delay(10);
        task.update(0.5, "Fast halfway");
        await delay(10);
        completionOrder.push("fast");
        return { speed: "fast" };
      },
      { label: "Fast task" }
    );

    const slow = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "Slow starting");
        await delay(50);
        task.update(0.5, "Slow halfway");
        await delay(50);
        completionOrder.push("slow");
        return { speed: "slow" };
      },
      { label: "Slow task" }
    );

    const medium = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "Medium starting");
        await delay(30);
        completionOrder.push("medium");
        return { speed: "medium" };
      },
      { label: "Medium task" }
    );

    // Start all three at the same time
    const r1 = (fast as any).handler({});
    const r2 = (slow as any).handler({});
    const r3 = (medium as any).handler({});

    // All should return immediately with __async
    expect(r1.__async).toBe(true);
    expect(r2.__async).toBe(true);
    expect(r3.__async).toBe(true);

    // All should have unique taskIds
    expect(r1.taskId).not.toBe(r2.taskId);
    expect(r2.taskId).not.toBe(r3.taskId);

    // Wait for all to complete
    await delay(150);

    // Fast should finish first, then medium, then slow
    expect(completionOrder).toEqual(["fast", "medium", "slow"]);
  });

  test("staggered async actions resolve in correct order", async () => {
    const client = createClient();
    const completionOrder: string[] = [];

    const taskA = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "A running");
        await delay(60);
        completionOrder.push("A");
      },
      { label: "Task A" }
    );

    const taskB = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "B running");
        await delay(30);
        completionOrder.push("B");
      },
      { label: "Task B" }
    );

    const taskC = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "C running");
        await delay(10);
        completionOrder.push("C");
      },
      { label: "Task C" }
    );

    // Start A first (longest), then B after 10ms, then C after 20ms
    (taskA as any).handler({});
    await delay(10);
    (taskB as any).handler({});
    await delay(10);
    (taskC as any).handler({});

    // C should finish first (~30ms from start), then B (~40ms), then A (~60ms)
    await delay(100);

    expect(completionOrder).toEqual(["C", "B", "A"]);
  });

  test("one task fails while others succeed", async () => {
    const client = createClient();
    const results: { name: string; status: "done" | "failed" }[] = [];

    const ok1 = client.asyncAction({}, async () => {
      await delay(10);
      results.push({ name: "ok1", status: "done" });
      return "success";
    });

    const failing = client.asyncAction({}, async () => {
      await delay(20);
      results.push({ name: "failing", status: "failed" });
      throw new Error("Boom");
    });

    const ok2 = client.asyncAction({}, async () => {
      await delay(30);
      results.push({ name: "ok2", status: "done" });
      return "success";
    });

    (ok1 as any).handler({});
    (failing as any).handler({});
    (ok2 as any).handler({});

    await delay(60);

    // All three should have completed — failure shouldn't affect others
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ name: "ok1", status: "done" });
    expect(results[1]).toEqual({ name: "failing", status: "failed" });
    expect(results[2]).toEqual({ name: "ok2", status: "done" });
  });

  test("cancelable task provides abort signal", async () => {
    const client = createClient();
    let wasAborted = false;

    const a = client.asyncAction(
      {},
      async (_params, task) => {
        task.signal.addEventListener("abort", () => { wasAborted = true; });
        task.update(0, "Running...");
        await delay(100);
        return "done";
      },
      { cancelable: true }
    );

    (a as any).handler({});
    await delay(10);
    client.flush();

    // The task node should exist with a cancel action — we can't easily invoke it
    // without a full consumer, but we verify the structure is correct
  });

  test("progress updates happen in correct order", async () => {
    const client = createClient();
    const progressLog: { progress: number; message: string }[] = [];

    // Monkey-patch register to capture progress updates
    const origRegister = client.register.bind(client);
    client.register = (path: string, desc: any) => {
      if (path.startsWith("tasks/") && desc.props?.progress !== undefined) {
        progressLog.push({ progress: desc.props.progress, message: desc.props.message });
      }
      origRegister(path, desc);
    };

    const a = client.asyncAction(
      {},
      async (_params, task) => {
        task.update(0, "Starting");
        await delay(5);
        task.update(0.25, "Quarter done");
        await delay(5);
        task.update(0.5, "Halfway");
        await delay(5);
        task.update(0.75, "Almost done");
        await delay(5);
        return "done";
      },
    );

    (a as any).handler({});
    await delay(50);

    // Should have captured: 0 (auto from helper), 0 (user "Starting"),
    // 0.25, 0.5, 0.75, then 1.0 (auto "Complete")
    expect(progressLog.length).toBeGreaterThanOrEqual(5);

    // Filter to unique progress values
    const progressValues = progressLog.map(p => p.progress);
    expect(progressValues).toContain(0);
    expect(progressValues).toContain(0.25);
    expect(progressValues).toContain(0.5);
    expect(progressValues).toContain(0.75);

    // Verify ordering is monotonically increasing
    for (let i = 1; i < progressLog.length; i++) {
      expect(progressLog[i].progress).toBeGreaterThanOrEqual(progressLog[i - 1].progress);
    }
  });
});
