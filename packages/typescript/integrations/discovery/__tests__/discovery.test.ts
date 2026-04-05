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

describe("createDiscoveryService", () => {
  test("scans local descriptors and prunes removed ones", async () => {
    const providersDir = createTempDir("slop-discovery-ts-scan");
    const service = createDiscoveryService({
      providersDirs: [providersDir],
      enableBridge: false,
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

      extension!.send(JSON.stringify({
        type: "provider-unavailable",
        providerKey: "browser-app",
      }));

      await waitUntil(() => !service.getDiscovered().some((provider) => provider.id === "browser-app"));
    } finally {
      await closeWebSocket(extension);
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
