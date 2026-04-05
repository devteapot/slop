import { describe, test, expect } from "bun:test";
import { BridgeRelayTransport } from "../src/relay-transport";
import type { Bridge, BridgeProvider, RelayHandler } from "../src/bridge-client";
import { delay } from "./helpers";

describe("BridgeRelayTransport", () => {
  test("buffers early hello messages until onMessage is registered", async () => {
    const bridge = new FakeBridge();
    const transport = new BridgeRelayTransport(bridge, "tab-1");

    const connection = await transport.connect();
    const received: Array<Record<string, unknown>> = [];

    connection.onMessage((message) => {
      received.push(message as Record<string, unknown>);
    });

    await delay(0);

    expect(received[0]?.type).toBe("hello");
    expect(bridge.sent[0]).toEqual({ type: "relay-open", providerKey: "tab-1" });

    connection.close();
  });
});

class FakeBridge implements Bridge {
  sent: Record<string, unknown>[] = [];
  private subscribers = new Map<string, RelayHandler[]>();

  running(): boolean {
    return true;
  }

  providers(): BridgeProvider[] {
    return [];
  }

  onProviderChange(): void {}

  subscribeRelay(providerKey: string): RelayHandler[] {
    const handlers = this.subscribers.get(providerKey) ?? [];
    this.subscribers.set(providerKey, handlers);
    return handlers;
  }

  unsubscribeRelay(providerKey: string, handler: RelayHandler): void {
    const handlers = this.subscribers.get(providerKey);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }

  send(msg: Record<string, unknown>): void {
    this.sent.push(msg);
    if (msg.type === "slop-relay" && (msg.message as Record<string, unknown>)?.type === "connect") {
      const handlers = this.subscribers.get(msg.providerKey as string) ?? [];
      for (const handler of handlers) {
        handler({
          type: "hello",
          provider: { id: "tab-1", name: "Browser App", slop_version: "0.1", capabilities: [] },
        });
      }
    }
  }

  start(): void {}

  stop(): void {}
}
