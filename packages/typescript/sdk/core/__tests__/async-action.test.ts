import { describe, expect, it } from "bun:test";
import { ProviderBase } from "../src/provider";
import type { NodeDescriptor, PatchOp } from "../src/types";
import { AsyncActionResult } from "../src/types";

class FakeProvider extends ProviderBase {
  private registrations = new Map<string, NodeDescriptor>();

  constructor(regs: Record<string, NodeDescriptor>) {
    super({ id: "fake", name: "Fake" });
    for (const [p, d] of Object.entries(regs)) this.registrations.set(p, d);
    // trigger initial tree build
    (this as any).rebuild();
  }
  protected getRegistrations() {
    return this.registrations;
  }
  protected broadcast(_ops: PatchOp[]) {}
}

describe("async-action conventions", () => {
  it("AsyncActionResult -> status: accepted", async () => {
    const p = new FakeProvider({
      "task/runner": {
        type: "control",
        actions: {
          deploy: () => new AsyncActionResult("task-42", { note: "queued" }),
        },
      },
    });
    const r = (await p.executeInvoke({
      id: "inv-1",
      path: "/fake/task/runner",
      action: "deploy",
    })) as any;
    expect(r.status).toBe("accepted");
    expect(r.data.taskId).toBe("task-42");
    expect(r.data.note).toBe("queued");
  });

  it("{ __async: true } dict -> status: accepted (cross-SDK marker)", async () => {
    const p = new FakeProvider({
      "task/runner": {
        type: "control",
        actions: {
          deploy: () => ({ __async: true, taskId: "task-99", extra: 1 }),
        },
      },
    });
    const r = (await p.executeInvoke({
      id: "inv-1",
      path: "/fake/task/runner",
      action: "deploy",
    })) as any;
    expect(r.status).toBe("accepted");
    expect(r.data.taskId).toBe("task-99");
    expect(r.data.extra).toBe(1);
    expect(r.data.__async).toBeUndefined();
  });
});
