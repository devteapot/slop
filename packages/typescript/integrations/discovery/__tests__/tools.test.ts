import { describe, test, expect } from "bun:test";
import type { DiscoveryService } from "../src/discovery";
import { createDynamicTools, createToolHandlers } from "../src/tools";

const tree = {
  id: "root",
  type: "root",
  properties: { label: "Test App" },
  children: [{
    id: "todo-1",
    type: "item",
    properties: { label: "Todo 1" },
    affordances: [{ action: "complete", description: "Complete item" }],
  }],
};

describe("discovery tools", () => {
  test("createDynamicTools prefixes provider ids and resolves actions", () => {
    const discovery = createFakeDiscovery();
    const toolSet = createDynamicTools(discovery);

    expect(toolSet.tools).toHaveLength(1);
    expect(toolSet.tools[0].name).toBe("todo_app__todo_1__complete");
    expect(toolSet.tools[0].description).toContain("[Todo App]");
    expect(toolSet.resolve("todo_app__todo_1__complete")).toEqual({
      providerId: "todo-app",
      path: "/todo-1",
      action: "complete",
      targets: undefined,
    });
  });

  test("createToolHandlers list, connect, and disconnect apps", async () => {
    const discovery = createFakeDiscovery();
    const handlers = createToolHandlers(discovery);

    const list = await handlers.listApps();
    expect(list.content[0].text).toContain("Test App");

    const connect = await handlers.connectApp({ app: "todo-app" });
    expect(connect.content[0].text).toContain("## Todo App");
    expect(connect.content[0].text).toContain("complete");

    const disconnect = await handlers.disconnectApp({ app: "todo-app" });
    expect(disconnect.content[0].text).toContain('Disconnected from "todo-app"');
  });
});

function createFakeDiscovery(): DiscoveryService {
  const provider = {
    id: "todo-app",
    name: "Todo App",
    descriptor: {
      id: "todo-app",
      name: "Todo App",
      slop_version: "0.1",
      transport: { type: "ws", url: "ws://example.test/slop" },
      capabilities: [],
    },
    consumer: {
      getTree() {
        return tree;
      },
    },
    subscriptionId: "sub-1",
    status: "connected",
  };

  return {
    getDiscovered() {
      return [provider.descriptor];
    },
    getProviders() {
      return [provider as any];
    },
    getProvider() {
      return provider as any;
    },
    async ensureConnected() {
      return provider as any;
    },
    disconnect() {
      return true;
    },
    onStateChange() {},
    start() {},
    stop() {},
  };
}
