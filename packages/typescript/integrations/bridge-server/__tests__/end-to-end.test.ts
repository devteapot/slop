import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SlopNode } from "@slop-ai/consumer";
import type { Down, Up } from "@slop-ai/relay-cli/protocol";
import WebSocket from "ws";
import { type BridgeServerHandle, createBridgeServer } from "../src/http";
import { parseTokenRegistry } from "../src/tokens";

const MCP_TOKEN = "test-mcp-token-0001";
const RELAY_TOKEN = "test-relay-token-0001";

const tree: SlopNode = {
  id: "root",
  type: "app",
  properties: { title: "Fake App" },
  children: [
    {
      id: "button",
      type: "button",
      properties: { label: "Increment" },
      affordances: [
        {
          action: "click",
          description: "Increment the counter.",
          params: { type: "object", properties: {} },
        },
      ],
    },
  ],
};

describe("bridge server", () => {
  let server: BridgeServerHandle | null = null;
  let relay: WebSocket | null = null;
  const relayFrames: Down[] = [];

  beforeEach(async () => {
    relayFrames.length = 0;
    server = createBridgeServer({
      port: 0,
      hostname: "127.0.0.1",
      tokens: parseTokenRegistry(
        JSON.stringify({
          user_test: { mcpToken: MCP_TOKEN, relayToken: RELAY_TOKEN },
        }),
      ),
      logger: { info: () => {}, error: () => {} },
      idleTimeoutMs: 60_000,
    });

    relay = await connectRelay(server.port, relayFrames);
  });

  afterEach(async () => {
    relay?.close();
    relay = null;
    server?.stop();
    server = null;
  });

  test("lists relayed apps, opens state, invokes actions, and unsubscribes on session close", async () => {
    if (!server) throw new Error("server not started");

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${MCP_TOKEN}` },
      },
    });
    const client = new Client({ name: "bridge-test", version: "0.0.0" });
    await client.connect(transport);

    const listResult = (await client.callTool({ name: "list_apps", arguments: {} })) as CallToolResult;
    const listPayload = listResult.structuredContent as { providers: { id: string; connected: boolean }[] };
    expect(listPayload.providers).toContainEqual(expect.objectContaining({ id: "fake-app", connected: true }));

    const openResult = (await client.callTool({
      name: "open_app",
      arguments: { app: "fake-app" },
    })) as CallToolResult;
    const openPayload = openResult.structuredContent as { selected: { id: string; tree: SlopNode } };
    expect(openPayload.selected.id).toBe("fake-app");
    expect(openPayload.selected.tree.id).toBe("root");
    expect(relayFrames).toContainEqual(expect.objectContaining({ t: "subscribe", providerId: "fake-app" }));

    const actionResult = (await client.callTool({
      name: "app_action",
      arguments: { app: "fake-app", path: "/button", action: "click", params: {} },
    })) as CallToolResult;
    expect(actionResult.isError).not.toBe(true);
    expect(actionResult.content?.[0]?.text).toContain("Done");
    expect(relayFrames).toContainEqual(
      expect.objectContaining({ t: "invoke", providerId: "fake-app", path: "/button", action: "click" }),
    );

    await transport.terminateSession();
    await waitFor(() => relayFrames.some((frame) => frame.t === "unsubscribe"));
  });
});

async function connectRelay(port: number, received: Down[]): Promise<WebSocket> {
  const relay = new WebSocket(`ws://127.0.0.1:${port}/relay`, {
    headers: { Authorization: `Bearer ${RELAY_TOKEN}` },
  });
  relay.on("message", (raw) => {
    const frame = JSON.parse(raw.toString()) as Down;
    received.push(frame);
    if (frame.t === "subscribe") {
      sendRelay(relay, {
        t: "snapshot",
        reqId: frame.reqId,
        subId: frame.subId,
        tree,
        version: 1,
        seq: 0,
      });
      sendRelay(relay, {
        t: "patch",
        subId: frame.subId,
        ops: [{ op: "replace", path: "/properties/title", value: "Fake App Updated" }],
        version: 2,
        seq: 1,
      });
      return;
    }
    if (frame.t === "invoke") {
      sendRelay(relay, {
        t: "result",
        reqId: frame.reqId,
        ok: true,
        data: { invoked: frame.action },
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    relay.once("open", () => resolve());
    relay.once("error", reject);
  });

  sendRelay(relay, { t: "hello", relayVersion: "test", protocolVersion: 1 });
  sendRelay(relay, {
    t: "providers",
    list: [
      {
        id: "fake-app",
        name: "Fake App",
        transport: "ws",
        source: "local",
        status: "connected",
        capabilities: ["state", "invoke"],
      },
    ],
  });
  return relay;
}

function sendRelay(relay: WebSocket, frame: Up): void {
  relay.send(JSON.stringify(frame));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await Bun.sleep(10);
  }
}
