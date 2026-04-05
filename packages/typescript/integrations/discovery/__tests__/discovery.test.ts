import { describe, test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { createDiscoveryService } from "../src/discovery";
import type { Bridge, BridgeProvider, RelayHandler } from "../src/bridge-client";
import {
  createMockSlopProviderServer,
  createTempDir,
  delay,
  getFreePort,
  removeTempDir,
  waitUntil,
  writeDescriptor,
} from "./helpers";

describe("createDiscoveryService", () => {
  test("scans local descriptors and prunes removed ones", async () => {
    const providersDir = createTempDir("slop-discovery-ts-scan");
    const service = createDiscoveryService({
      providersDirs: [providersDir],
      enableBridge: false,
      watchProviders: false,
      hostBridge: false,
      bridgeUrl: "ws://127.0.0.1:1/slop-bridge",
      scanIntervalMs: 50,
      watchDebounceMs: 20,
      bridgeDialTimeoutMs: 20,
      bridgeRetryDelayMs: 20,
    });

    try {
      writeDescriptor(providersDir, "test-app.json", {
        id: "test-app",
        name: "Test App",
        slop_version: "0.1",
        transport: { type: "unix", path: "/tmp/slop/test-app.sock" },
        capabilities: ["state"],
      });

      service.start();

      await waitUntil(() => service.getDiscovered().length === 1);
      rmSync(`${providersDir}/test-app.json`);
      await waitUntil(() => service.getDiscovered().length === 0);
    } finally {
      service.stop();
      removeTempDir(providersDir);
    }
  });

  test("bridge provider removals prune immediately", async () => {
    const bridge = new FakeBridge();
    const service = createDiscoveryService({
      bridge,
      enableBridge: false,
      watchProviders: false,
      scanIntervalMs: 1000,
      watchDebounceMs: 20,
    });

    try {
      service.start();

      bridge.setProviders([{
        providerKey: "browser-app",
        tabId: 1,
        id: "browser-app",
        name: "Browser App",
        transport: "postmessage",
      }]);

      await waitUntil(() => service.getDiscovered().some((provider) => provider.id === "browser-app"));

      bridge.setProviders([]);

      await waitUntil(() => !service.getDiscovered().some((provider) => provider.id === "browser-app"));
    } finally {
      service.stop();
    }
  });

  test("explicit disconnect does not reconnect", async () => {
    const providersDir = createTempDir("slop-discovery-ts-disconnect");
    const port = await getFreePort();
    const providerServer = await createMockSlopProviderServer({ port, providerName: "Test App" });
    const service = createDiscoveryService({
      providersDirs: [providersDir],
      enableBridge: false,
      watchProviders: false,
      hostBridge: false,
      bridgeUrl: "ws://127.0.0.1:1/slop-bridge",
      connectTimeoutMs: 200,
      reconnectBaseDelayMs: 20,
      maxReconnectDelayMs: 40,
      bridgeDialTimeoutMs: 20,
      bridgeRetryDelayMs: 20,
    });

    try {
      writeDescriptor(providersDir, "test-app.json", {
        id: "test-app",
        name: "Test App",
        slop_version: "0.1",
        transport: { type: "ws", url: providerServer.url },
        capabilities: ["state"],
      });

      service.start();
      await waitUntil(() => service.getDiscovered().length === 1);

      const provider = await service.ensureConnected("test-app");
      expect(provider?.id).toBe("test-app");
      expect(providerServer.getConnectionCount()).toBe(1);

      expect(service.disconnect("test-app")).toBe(true);
      await delay(80);

      expect(providerServer.getConnectionCount()).toBe(1);
      expect(service.getProviders()).toHaveLength(0);
    } finally {
      service.stop();
      await providerServer.close();
      removeTempDir(providersDir);
    }
  });

  test("idle disconnect does not reconnect", async () => {
    const providersDir = createTempDir("slop-discovery-ts-idle");
    const port = await getFreePort();
    const providerServer = await createMockSlopProviderServer({ port, providerName: "Idle App" });
    const service = createDiscoveryService({
      providersDirs: [providersDir],
      enableBridge: false,
      watchProviders: false,
      hostBridge: false,
      bridgeUrl: "ws://127.0.0.1:1/slop-bridge",
      idleTimeoutMs: 20,
      idleCheckIntervalMs: 20,
      reconnectBaseDelayMs: 20,
      maxReconnectDelayMs: 40,
      bridgeDialTimeoutMs: 20,
      bridgeRetryDelayMs: 20,
    });

    try {
      writeDescriptor(providersDir, "idle-app.json", {
        id: "idle-app",
        name: "Idle App",
        slop_version: "0.1",
        transport: { type: "ws", url: providerServer.url },
        capabilities: ["state"],
      });

      service.start();
      await waitUntil(() => service.getDiscovered().length === 1);
      await service.ensureConnected("idle-app");
      expect(providerServer.getConnectionCount()).toBe(1);

      await waitUntil(() => service.getProviders().length === 0, { timeoutMs: 500, intervalMs: 20 });
      await delay(80);

      expect(providerServer.getConnectionCount()).toBe(1);
    } finally {
      service.stop();
      await providerServer.close();
      removeTempDir(providersDir);
    }
  });
});

class FakeBridge implements Bridge {
  private currentProviders: BridgeProvider[] = [];
  private changeCallback: (() => void) | null = null;
  private relaySubscribers = new Map<string, RelayHandler[]>();

  setProviders(providers: BridgeProvider[]) {
    this.currentProviders = providers;
    this.changeCallback?.();
  }

  running(): boolean {
    return true;
  }

  providers(): BridgeProvider[] {
    return this.currentProviders;
  }

  onProviderChange(fn: () => void): void {
    this.changeCallback = fn;
  }

  subscribeRelay(providerKey: string): RelayHandler[] {
    const handlers = this.relaySubscribers.get(providerKey) ?? [];
    this.relaySubscribers.set(providerKey, handlers);
    return handlers;
  }

  unsubscribeRelay(providerKey: string, handler: RelayHandler): void {
    const handlers = this.relaySubscribers.get(providerKey);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }

  send(): void {}

  start(): void {}

  stop(): void {}
}
