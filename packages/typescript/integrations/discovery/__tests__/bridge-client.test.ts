import { describe, test, expect } from "bun:test";
import { WebSocketServer } from "ws";
import { createBridgeClient } from "../src/bridge-client";
import { delay, getFreePort, waitUntil } from "./helpers";

describe("createBridgeClient", () => {
  test("mirrors provider announcements", async () => {
    const port = await getFreePort();
    const server = new WebSocketServer({ host: "127.0.0.1", port, path: "/slop-bridge" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    const client = createBridgeClient({
      url: `ws://127.0.0.1:${port}/slop-bridge`,
      reconnectIntervalMs: 20,
    });

    try {
      await client.connectOnce();
      await waitUntil(() => server.clients.size === 1);
      const [socket] = Array.from(server.clients);

      socket.send(JSON.stringify({
        type: "provider-available",
        tabId: 1,
        providerKey: "browser-app",
        provider: { id: "browser-app", name: "Browser App", transport: "postmessage" },
      }));

      await waitUntil(() => client.providers().length === 1);
      expect(client.providers()[0].providerKey).toBe("browser-app");

      socket.send(JSON.stringify({
        type: "provider-unavailable",
        providerKey: "browser-app",
      }));

      await waitUntil(() => client.providers().length === 0);
      expect(client.running()).toBe(true);
    } finally {
      client.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test("stop prevents reconnect loop", async () => {
    const port = await getFreePort();
    const server = new WebSocketServer({ host: "127.0.0.1", port, path: "/slop-bridge" });
    let connectionCount = 0;
    server.on("connection", () => {
      connectionCount += 1;
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    const client = createBridgeClient({
      url: `ws://127.0.0.1:${port}/slop-bridge`,
      reconnectIntervalMs: 20,
    });

    try {
      client.start();
      await waitUntil(() => connectionCount === 1);

      client.stop();
      await delay(80);

      expect(connectionCount).toBe(1);
    } finally {
      client.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test("connectOnce failure does not arm reconnect", async () => {
    const port = await getFreePort();
    const url = `ws://127.0.0.1:${port}/slop-bridge`;
    const client = createBridgeClient({ url, reconnectIntervalMs: 20 });

    await expect(client.connectOnce()).rejects.toBeDefined();

    const server = new WebSocketServer({ host: "127.0.0.1", port, path: "/slop-bridge" });
    let connectionCount = 0;
    server.on("connection", () => {
      connectionCount += 1;
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    try {
      await delay(80);
      expect(connectionCount).toBe(0);
    } finally {
      client.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
