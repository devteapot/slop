import { describe, expect, it } from "bun:test";
import { ProviderBase } from "../src/provider";
import type { NodeDescriptor, PatchOp } from "../src/types";

class RecordingProvider extends ProviderBase {
  broadcasts: PatchOp[][] = [];
  private registrations = new Map<string, NodeDescriptor | (() => NodeDescriptor)>();

  constructor(regs: Record<string, NodeDescriptor | (() => NodeDescriptor)>) {
    super({ id: "fake", name: "Fake" });
    for (const [p, d] of Object.entries(regs)) this.registrations.set(p, d);
    (this as any).rebuild();
  }
  // Evaluate descriptor functions on every rebuild, like the server does.
  protected getRegistrations() {
    const out = new Map<string, NodeDescriptor>();
    for (const [p, d] of this.registrations) out.set(p, typeof d === "function" ? d() : d);
    return out;
  }
  protected broadcast(ops: PatchOp[]) {
    this.broadcasts.push(ops);
  }
}

describe("invoke ordering (spec/core/messages.md §Message ordering)", () => {
  it("broadcasts handler state changes before returning an ok result", async () => {
    let count = 0;
    const p = new RecordingProvider({
      counter: () =>
        ({
          type: "status",
          props: { count },
          actions: {
            bump: () => {
              count += 1;
            },
          },
        }) as NodeDescriptor,
    });
    const before = p.broadcasts.length;
    const r = (await p.executeInvoke({
      id: "inv-1",
      path: "/fake/counter",
      action: "bump",
    })) as any;
    expect(r.status).toBe("ok");
    // rebuild() ran before the result was produced, so the mutation's patch
    // ops were already handed to the transport layer.
    expect(p.broadcasts.length).toBeGreaterThan(before);
  });

  it("broadcasts state changes made before a handler error, before the error result", async () => {
    let count = 0;
    const p = new RecordingProvider({
      counter: () =>
        ({
          type: "status",
          props: { count },
          actions: {
            bump_then_fail: () => {
              count += 1;
              throw new Error("boom");
            },
          },
        }) as NodeDescriptor,
    });
    const before = p.broadcasts.length;
    const r = (await p.executeInvoke({
      id: "inv-2",
      path: "/fake/counter",
      action: "bump_then_fail",
    })) as any;
    expect(r.status).toBe("error");
    expect(r.error.message).toBe("boom");
    expect(p.broadcasts.length).toBeGreaterThan(before);
  });
});
