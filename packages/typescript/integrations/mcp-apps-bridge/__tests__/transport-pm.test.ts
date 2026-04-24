import { describe, test, expect, beforeEach } from "bun:test";
import { SameWindowPostMessageTransport } from "../src/transport-pm";
import type { SlopMessage } from "@slop-ai/consumer";

// Minimal browser shim — Bun test runs in Node, so we stand up a synthetic
// `window` + `MessageEvent` surface that mirrors what the transport uses.
type Listener = (event: { source: unknown; data: unknown }) => void;

class FakeWindow {
  listeners: Listener[] = [];
  posted: { data: unknown; origin: string }[] = [];

  addEventListener(type: string, fn: Listener) {
    if (type === "message") this.listeners.push(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    if (type !== "message") return;
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  postMessage(data: unknown, origin: string) {
    this.posted.push({ data, origin });
  }
  dispatchFromSource(source: unknown, data: unknown) {
    for (const fn of this.listeners) fn({ source, data });
  }
}

let fakeWindow: FakeWindow;

beforeEach(() => {
  fakeWindow = new FakeWindow();
  (globalThis as any).window = fakeWindow;
});

describe("SameWindowPostMessageTransport", () => {
  test("wraps outgoing messages in { slop: true, message }", async () => {
    const transport = new SameWindowPostMessageTransport({
      targetWindow: fakeWindow as unknown as Window,
    });
    const conn = await transport.connect();
    // connect sends a handshake
    expect(fakeWindow.posted[0]?.data).toEqual({
      slop: true,
      message: { type: "connect" },
    });

    const invoke: SlopMessage = { type: "invoke", id: "1", path: "/", action: "ping" };
    conn.send(invoke);
    expect(fakeWindow.posted.at(-1)?.data).toEqual({ slop: true, message: invoke });
  });

  test("only delivers frames with slop:true; ignores MCP Apps JSON-RPC frames", async () => {
    const transport = new SameWindowPostMessageTransport({
      targetWindow: fakeWindow as unknown as Window,
    });
    const conn = await transport.connect();

    const received: SlopMessage[] = [];
    conn.onMessage((m) => received.push(m));

    // MCP Apps-style JSON-RPC frame — should be ignored.
    fakeWindow.dispatchFromSource(fakeWindow, {
      jsonrpc: "2.0",
      method: "ui/initialize",
      params: {},
    });
    // SLOP frame from wrong source window — ignored.
    fakeWindow.dispatchFromSource({}, { slop: true, message: { type: "hello" } });
    // SLOP frame from correct source — delivered.
    const hello = {
      type: "hello",
      provider: {
        id: "p",
        name: "P",
        slop_version: "0.1",
        capabilities: ["state"],
      },
    };
    fakeWindow.dispatchFromSource(fakeWindow, { slop: true, message: hello });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(hello as SlopMessage);
  });

  test("close() detaches the message listener", async () => {
    const transport = new SameWindowPostMessageTransport({
      targetWindow: fakeWindow as unknown as Window,
    });
    const conn = await transport.connect();
    expect(fakeWindow.listeners).toHaveLength(1);
    conn.close();
    expect(fakeWindow.listeners).toHaveLength(0);
  });
});
