import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { createRelayBridge } from "../src/bridge";
import type { Up } from "../src/protocol";
import { createRelayClient } from "../src/relay-client";
import { MockRelayBridge } from "./mock-bridge";

describe("relay bridge", () => {
  test("sends hello and providers, then handles subscribe, patch, invoke, and unsubscribe", async () => {
    const providersDir = createTempDir("slop-relay-providers");
    const bridgePort = await getFreePort();
    const providerPort = await getFreePort();
    const mockBridge = new MockRelayBridge(bridgePort);
    const providerServer = await createMockSlopProvider({ port: providerPort });
    let relay: ReturnType<typeof createRelayBridge> | null = null;

    try {
      writeDescriptor(providersDir, "fake-provider.json", {
        id: "fake-provider",
        name: "Fake Provider",
        slop_version: "0.1",
        transport: { type: "ws", url: providerServer.url },
        capabilities: ["state"],
      });
      await mockBridge.start();

      relay = createRelayBridge({
        url: mockBridge.url,
        token: "dev",
        relayVersion: "0.1.0",
        discoveryOptions: {
          providersDirs: [providersDir],
          enableBridge: false,
          watchProviders: false,
          hostBridge: false,
          scanIntervalMs: 50,
          bridgeDialTimeoutMs: 20,
          bridgeRetryDelayMs: 20,
        },
        reconnectBaseDelayMs: 20,
        reconnectMaxDelayMs: 40,
      });
      relay.start();

      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "hello"));
      await waitUntil(() =>
        mockBridge.frames.some(
          (frame) => frame.t === "providers" && frame.list.some((provider) => provider.id === "fake-provider"),
        ),
      );

      mockBridge.send({ t: "subscribe", reqId: "req-sub", subId: "bridge-sub", providerId: "fake-provider" });
      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "snapshot" && frame.subId === "bridge-sub"));
      const snapshot = mockBridge.frames.find(
        (frame): frame is Extract<Up, { t: "snapshot" }> => frame.t === "snapshot",
      );
      expect(snapshot?.tree.id).toBe("root");

      providerServer.patch();
      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "patch" && frame.subId === "bridge-sub"));
      const patch = mockBridge.frames.find((frame): frame is Extract<Up, { t: "patch" }> => frame.t === "patch");
      expect(patch?.ops[0]?.path).toBe("/properties/count");
      expect(patch?.version).toBe(2);

      mockBridge.send({
        t: "invoke",
        reqId: "req-invoke",
        providerId: "fake-provider",
        path: "/",
        action: "increment",
        params: { by: 1 },
      });
      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "result" && frame.reqId === "req-invoke"));
      const result = mockBridge.frames.find(
        (frame): frame is Extract<Up, { t: "result"; ok: true }> =>
          frame.t === "result" && frame.reqId === "req-invoke",
      );
      expect(result?.ok).toBe(true);
      expect(result?.data).toEqual({ invoked: true });

      mockBridge.send({ t: "unsubscribe", subId: "bridge-sub" });
      await delay(20);
      const patchCount = mockBridge.frames.filter((frame) => frame.t === "patch").length;
      providerServer.patch();
      await delay(50);
      expect(mockBridge.frames.filter((frame) => frame.t === "patch")).toHaveLength(patchCount);
    } finally {
      relay?.stop();
      await providerServer.close();
      await mockBridge.close();
      removeTempDir(providersDir);
    }
  });

  test("rejects non-object invoke params", async () => {
    const bridgePort = await getFreePort();
    const mockBridge = new MockRelayBridge(bridgePort);
    await mockBridge.start();
    const relay = createRelayBridge({
      url: mockBridge.url,
      token: "dev",
      relayVersion: "0.1.0",
      discoveryOptions: { enableBridge: false, watchProviders: false, hostBridge: false },
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 40,
    });

    try {
      relay.start();
      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "hello"));
      mockBridge.send({
        t: "invoke",
        reqId: "bad",
        providerId: "fake-provider",
        path: "/",
        action: "increment",
        params: [] as never,
      });
      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "result" && frame.reqId === "bad"));
      const result = mockBridge.frames.find(
        (frame): frame is Extract<Up, { t: "result"; ok: false }> => frame.t === "result" && frame.reqId === "bad",
      );
      expect(result?.ok).toBe(false);
      expect(result?.error.code).toBe("invalid_params");
    } finally {
      relay.stop();
      await mockBridge.close();
    }
  });

  test("relay client retains only providers while disconnected", async () => {
    const bridgePort = await getFreePort();
    const mockBridge = new MockRelayBridge(bridgePort);
    const client = createRelayClient({
      url: mockBridge.url,
      token: "dev",
      relayVersion: "0.1.0",
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 40,
    });

    client.send({
      t: "providers",
      list: [
        {
          id: "fake-provider",
          name: "Fake Provider",
          transport: "ws",
          source: "local",
          status: "disconnected",
        },
      ],
    });
    client.send({ t: "result", reqId: "stale-result", ok: true });
    client.send({
      t: "snapshot",
      reqId: "stale-snapshot",
      subId: "stale-sub",
      tree: { id: "root", type: "app" },
    });
    client.send({ t: "patch", subId: "stale-sub", ops: [], version: 1 });

    try {
      await mockBridge.start();
      client.start();
      await waitUntil(() => mockBridge.frames.some((frame) => frame.t === "providers"));

      expect(mockBridge.frames.map((frame) => frame.t)).toEqual(["hello", "providers"]);
    } finally {
      client.stop();
      await mockBridge.close();
    }
  });
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  return dir;
}

function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function writeDescriptor(dir: string, fileName: string, descriptor: unknown): void {
  const path = join(dir, fileName);
  writeFileSync(path, JSON.stringify(descriptor, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

async function createMockSlopProvider(options: { port: number }) {
  const clients = new Set<WebSocket>();
  let subscriptionId: string | null = null;
  let count = 0;
  const server = new WebSocketServer({ host: "127.0.0.1", port: options.port, path: "/slop" });

  server.on("connection", (socket) => {
    clients.add(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        provider: { id: "fake-provider", name: "Fake Provider", slop_version: "0.1", capabilities: ["state"] },
      }),
    );
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === "subscribe" && typeof message.id === "string") {
        subscriptionId = message.id;
        socket.send(
          JSON.stringify({
            type: "snapshot",
            id: message.id,
            version: 1,
            tree: {
              id: "root",
              type: "app",
              properties: { count },
              affordances: [{ action: "increment", label: "Increment" }],
              children: [],
            },
          }),
        );
      }
      if (message.type === "invoke" && typeof message.id === "string") {
        socket.send(JSON.stringify({ type: "result", id: message.id, status: "ok", data: { invoked: true } }));
      }
    });
    socket.on("close", () => clients.delete(socket));
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));

  return {
    url: `ws://127.0.0.1:${options.port}/slop`,
    patch() {
      count += 1;
      if (!subscriptionId) return;
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "patch",
              subscription: subscriptionId,
              version: count + 1,
              ops: [{ op: "replace", path: "/properties/count", value: count }],
            }),
          );
        }
      }
    },
    async close() {
      for (const client of clients) client.terminate();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        server.close((error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function getFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitUntil(fn: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(10);
  }
  throw new Error("Condition not met before timeout");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
