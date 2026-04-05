import { describe, test, expect } from "bun:test";
import { rmSync } from "node:fs";
import WebSocket from "ws";
import { createDiscoveryService } from "../src/discovery";
import {
  closeWebSocket,
  connectWebSocket,
  createMockSlopProviderServer,
  createTempDir,
  delay,
  getFreePort,
  removeTempDir,
  waitUntil,
  writeDescriptor,
} from "./helpers";

const DEBUG_DISCOVERY_TESTS = process.env.SLOP_DEBUG_DISCOVERY_TESTS !== "0";

function debugLog(...args: unknown[]) {
  if (DEBUG_DISCOVERY_TESTS) {
    console.error("[discovery.test]", ...args);
  }
}

describe("createDiscoveryService", () => {
  test("scans local descriptors and prunes removed ones", async () => {
    debugLog("start", "scans local descriptors and prunes removed ones");
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
      debugLog("service started", "scan test");

      await waitUntil(() => service.getDiscovered().length === 1);
      debugLog("descriptor discovered", service.getDiscovered().map((provider) => provider.id));
      rmSync(`${providersDir}/test-app.json`);
      await waitUntil(() => service.getDiscovered().length === 0);
      debugLog("descriptor pruned");
    } finally {
      debugLog("cleanup start", "scan test");
      service.stop();
      removeTempDir(providersDir);
      debugLog("cleanup done", "scan test");
    }
  });

  test("bridge provider removals prune immediately", async () => {
    debugLog("start", "bridge provider removals prune immediately");
    const port = await getFreePort();
    const bridgeUrl = `ws://127.0.0.1:${port}/slop-bridge`;
    const service = createDiscoveryService({
      hostBridge: true,
      bridgeUrl,
      bridgeDialTimeoutMs: 20,
      bridgeRetryDelayMs: 20,
      scanIntervalMs: 1000,
      watchDebounceMs: 20,
    });

    let extension: WebSocket | null = null;

    try {
      service.start();
      debugLog("service started", "bridge prune", { bridgeUrl });

      await waitUntil(async () => {
        try {
          extension = await connectWebSocket(bridgeUrl);
          return true;
        } catch {
          return false;
        }
      }, { timeoutMs: 1000, intervalMs: 20 });

      extension!.send(JSON.stringify({
        type: "provider-available",
        tabId: 1,
        providerKey: "browser-app",
        provider: {
          id: "browser-app",
          name: "Browser App",
          transport: "postmessage",
        },
      }));

      await waitUntil(() => service.getDiscovered().some((provider) => provider.id === "browser-app"));
      debugLog("bridge provider discovered");

      extension!.send(JSON.stringify({
        type: "provider-unavailable",
        providerKey: "browser-app",
      }));

      await waitUntil(() => !service.getDiscovered().some((provider) => provider.id === "browser-app"));
      debugLog("bridge provider pruned");
    } finally {
      debugLog("cleanup start", "bridge prune");
      await closeWebSocket(extension);
      service.stop();
      debugLog("cleanup done", "bridge prune");
    }
  });

  test("explicit disconnect does not reconnect", async () => {
    debugLog("start", "explicit disconnect does not reconnect");
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
      debugLog("service started", "explicit disconnect");
      await waitUntil(() => service.getDiscovered().length === 1);
      debugLog("descriptor discovered", "explicit disconnect");

      const provider = await service.ensureConnected("test-app");
      debugLog("provider connected", provider?.id);
      expect(provider?.id).toBe("test-app");
      expect(providerServer.getConnectionCount()).toBe(1);

      expect(service.disconnect("test-app")).toBe(true);
      debugLog("provider disconnected explicitly");
      await delay(80);

      expect(providerServer.getConnectionCount()).toBe(1);
      expect(service.getProviders()).toHaveLength(0);
    } finally {
      debugLog("cleanup start", "explicit disconnect");
      service.stop();
      await providerServer.close();
      removeTempDir(providersDir);
      debugLog("cleanup done", "explicit disconnect");
    }
  });

  test("idle disconnect does not reconnect", async () => {
    debugLog("start", "idle disconnect does not reconnect");
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
      debugLog("service started", "idle disconnect");
      await waitUntil(() => service.getDiscovered().length === 1);
      debugLog("descriptor discovered", "idle disconnect");
      await service.ensureConnected("idle-app");
      debugLog("provider connected", "idle-app");
      expect(providerServer.getConnectionCount()).toBe(1);

      await waitUntil(() => service.getProviders().length === 0, { timeoutMs: 500, intervalMs: 20 });
      debugLog("provider idled out");
      await delay(80);

      expect(providerServer.getConnectionCount()).toBe(1);
    } finally {
      debugLog("cleanup start", "idle disconnect");
      service.stop();
      await providerServer.close();
      removeTempDir(providersDir);
      debugLog("cleanup done", "idle disconnect");
    }
  });
});
