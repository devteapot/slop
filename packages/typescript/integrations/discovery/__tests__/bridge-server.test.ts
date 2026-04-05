import { describe, test, expect } from "bun:test";
import { createBridgeServer } from "../src/bridge-server";
import { connectWebSocket, getFreePort, waitUntil } from "./helpers";

describe("createBridgeServer", () => {
  test("replays providers to newly connected clients", async () => {
    const port = await getFreePort();
    const server = createBridgeServer({ host: "127.0.0.1", port, path: "/slop-bridge" });
    await server.start();

    const first = await connectWebSocket(`ws://127.0.0.1:${port}/slop-bridge`);

    try {
      first.send(JSON.stringify({
        type: "provider-available",
        tabId: 1,
        providerKey: "browser-app",
        provider: { id: "browser-app", name: "Browser App", transport: "postmessage" },
      }));

      await waitUntil(() => server.providers().length === 1);

      const second = await connectWebSocket(`ws://127.0.0.1:${port}/slop-bridge`);
      try {
        const replay = await new Promise<Record<string, unknown>>((resolve) => {
          second.once("message", (data) => resolve(JSON.parse(data.toString())));
        });
        expect(replay.type).toBe("provider-available");
        expect(replay.providerKey).toBe("browser-app");
      } finally {
        second.close();
      }
    } finally {
      first.close();
      server.stop();
    }
  });

  test("forwards relay control messages", async () => {
    const port = await getFreePort();
    const server = createBridgeServer({ host: "127.0.0.1", port, path: "/slop-bridge" });
    await server.start();

    const first = await connectWebSocket(`ws://127.0.0.1:${port}/slop-bridge`);
    const second = await connectWebSocket(`ws://127.0.0.1:${port}/slop-bridge`);
    const received: Array<Record<string, unknown>> = [];
    second.on("message", (data) => {
      received.push(JSON.parse(data.toString()));
    });

    try {
      first.send(JSON.stringify({ type: "relay-open", providerKey: "browser-app" }));
      await waitUntil(() => received.some((message) => message.type === "relay-open"));

      first.send(JSON.stringify({ type: "relay-close", providerKey: "browser-app" }));
      await waitUntil(() => received.some((message) => message.type === "relay-close"));
    } finally {
      first.close();
      second.close();
      server.stop();
    }
  });
});
