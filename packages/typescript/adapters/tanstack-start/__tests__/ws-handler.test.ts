import { describe, test, expect } from "bun:test";
import { createSlopServer } from "@slop-ai/server";
import type { Connection } from "@slop-ai/server";
import { createWebSocketHandler } from "../src/ws-handler";

class MockConnection implements Connection {
  messages: any[] = [];

  send(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {}
}

function createPeer(url: string) {
  const sent: any[] = [];
  const peer = {
    __slopRequest: {
      url,
      headers: { host: "localhost:3000" },
    },
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close() {},
  };

  return { peer, sent };
}

function rawMessage(message: any) {
  return {
    text() {
      return JSON.stringify(message);
    },
    toString() {
      return JSON.stringify(message);
    },
  };
}

describe("createWebSocketHandler", () => {
  test("mounts a browser UI provider under /ui and forwards invokes", async () => {
    const slop = createSlopServer({ id: "project-tracker", name: "Project Tracker" });
    slop.register("projects", { type: "collection", props: { total: 1 } });

    const handler = createWebSocketHandler({ resolve: () => slop });
    const { peer, sent } = createPeer("/slop?slop_role=provider&mount=ui");

    await handler.open(peer);
    expect(sent[0]).toEqual({ type: "connect" });

    await handler.message(
      peer,
      rawMessage({
        type: "hello",
        provider: {
          id: "ui",
          name: "Project Tracker UI",
          slop_version: "0.1",
          capabilities: ["state", "patches", "affordances"],
        },
      }),
    );

    expect(sent[1]).toMatchObject({
      type: "subscribe",
      path: "/",
      depth: -1,
    });

    await handler.message(
      peer,
      rawMessage({
        type: "snapshot",
        id: sent[1].id,
        version: 1,
        tree: {
          id: "ui",
          type: "root",
          properties: { label: "Project Tracker UI" },
          children: [
            {
              id: "filters",
              type: "status",
              properties: { status: "all" },
              affordances: [
                {
                  action: "set_filter",
                  params: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                    },
                    required: ["status"],
                  },
                },
              ],
            },
          ],
        },
      }),
    );

    const mountedTree = slop.getOutputTree();
    const uiNode = mountedTree.children?.find((child) => child.id === "ui");
    expect(uiNode).toBeDefined();
    expect(uiNode?.children?.[0]?.id).toBe("filters");

    await handler.message(
      peer,
      rawMessage({
        type: "patch",
        subscription: sent[1].id,
        version: 2,
        ops: [
          {
            op: "replace",
            path: "/filters/properties/status",
            value: "active",
          },
        ],
      }),
    );

    const patchedUiNode = slop.getOutputTree().children?.find((child) => child.id === "ui");
    expect(patchedUiNode?.children?.[0]?.properties?.status).toBe("active");

    const consumer = new MockConnection();
    const invokePromise = slop.handleMessage(consumer, {
      type: "invoke",
      id: "inv-1",
      path: "/ui/filters",
      action: "set_filter",
      params: { status: "archived" },
    });

    const invokeMessage = sent.find(
      (message) => message.type === "invoke" && message.id !== undefined,
    );
    expect(invokeMessage).toMatchObject({
      type: "invoke",
      path: "/ui/filters",
      action: "set_filter",
      params: { status: "archived" },
    });

    await handler.message(
      peer,
      rawMessage({
        type: "result",
        id: invokeMessage.id,
        status: "ok",
        data: { changed: true },
      }),
    );

    await invokePromise;
    expect(consumer.messages.at(-1)).toEqual({
      type: "result",
      id: "inv-1",
      status: "ok",
      data: { changed: true },
    });

    handler.close(peer);
    const afterDisconnect = slop.getOutputTree();
    expect(afterDisconnect.children?.find((child) => child.id === "ui")).toBeUndefined();
  });
});
