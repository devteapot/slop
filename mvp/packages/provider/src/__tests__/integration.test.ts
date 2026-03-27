import { describe, test, expect, afterEach } from "bun:test";
import type { SlopNode, PatchOp } from "@slop/types";
import { SlopProvider, UnixServerTransport } from "../index";
import { SlopConsumer, UnixClientTransport } from "../../../consumer/src/index";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOCKET_PATH = join(tmpdir(), `slop-test-${process.pid}.sock`);

function buildTodoTree(todos: { id: string; title: string; done: boolean }[]): SlopNode {
  return {
    id: "root",
    type: "root",
    properties: { label: "Test" },
    affordances: [
      {
        action: "add_todo",
        params: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    ],
    children: [
      {
        id: "todos",
        type: "collection",
        properties: { count: todos.length },
        children: todos.map((t) => ({
          id: t.id,
          type: "item",
          properties: { title: t.title, done: t.done },
          affordances: [{ action: "toggle" }, { action: "delete", dangerous: true }],
        })),
      },
    ],
  };
}

describe("Integration: Provider + Consumer over Unix socket", () => {
  let provider: SlopProvider;
  let consumer: SlopConsumer;

  afterEach(async () => {
    consumer?.disconnect();
    await provider?.stop();
  });

  test("full lifecycle: connect → subscribe → invoke → patch", async () => {
    // --- Provider setup ---
    let todos = [
      { id: "t1", title: "First", done: false },
      { id: "t2", title: "Second", done: true },
    ];
    let nextId = 3;

    provider = new SlopProvider({
      id: "test",
      name: "Test Provider",
      capabilities: ["state", "patches", "affordances"],
      transport: new UnixServerTransport(SOCKET_PATH),
    });

    provider.setTree(buildTodoTree(todos));

    provider.onInvoke("add_todo", (params) => {
      const todo = { id: `t${nextId++}`, title: params.title as string, done: false };
      todos.push(todo);
      provider.setTree(buildTodoTree(todos));
      return { id: todo.id };
    });

    provider.onInvoke("toggle", (_params, path) => {
      const id = path.split("/").pop()!;
      const todo = todos.find((t) => t.id === id);
      if (!todo) throw { code: "not_found", message: "not found" };
      todo.done = !todo.done;
      provider.setTree(buildTodoTree(todos));
    });

    provider.onInvoke("delete", (_params, path) => {
      const id = path.split("/").pop()!;
      todos = todos.filter((t) => t.id !== id);
      provider.setTree(buildTodoTree(todos));
    });

    await provider.start();

    // --- Consumer connects ---
    consumer = new SlopConsumer({
      transport: new UnixClientTransport(SOCKET_PATH),
    });

    const hello = await consumer.connect();
    expect(hello.provider.name).toBe("Test Provider");
    expect(hello.provider.slop_version).toBe("0.1");

    // --- Subscribe ---
    const { id: subId, snapshot } = await consumer.subscribe("/", -1);
    expect(snapshot.id).toBe("root");
    expect(snapshot.children![0].children).toHaveLength(2);

    // --- Collect patches ---
    const patches: { ops: PatchOp[]; version: number }[] = [];
    consumer.on("patch", (_subId: string, ops: PatchOp[], version: number) => {
      patches.push({ ops, version });
    });

    // --- Invoke: add todo ---
    const addResult = await consumer.invoke("/", "add_todo", { title: "Third" });
    expect(addResult.status).toBe("ok");
    expect((addResult.data as any)?.id).toBe("t3");

    // Wait for patch to arrive
    await new Promise((r) => setTimeout(r, 50));
    expect(patches.length).toBeGreaterThanOrEqual(1);

    // Check mirrored tree
    const tree1 = consumer.getTree(subId)!;
    expect(tree1.children![0].children).toHaveLength(3);
    expect(tree1.children![0].children![2].properties?.title).toBe("Third");

    // --- Invoke: toggle ---
    const toggleResult = await consumer.invoke("/todos/t1", "toggle", {});
    expect(toggleResult.status).toBe("ok");

    await new Promise((r) => setTimeout(r, 50));
    const tree2 = consumer.getTree(subId)!;
    expect(tree2.children![0].children![0].properties?.done).toBe(true);

    // --- Invoke: delete ---
    const deleteResult = await consumer.invoke("/todos/t2", "delete", {});
    expect(deleteResult.status).toBe("ok");

    await new Promise((r) => setTimeout(r, 50));
    const tree3 = consumer.getTree(subId)!;
    expect(tree3.children![0].children).toHaveLength(2); // t1 and t3 remain
    expect(tree3.children![0].children!.find((c) => c.id === "t2")).toBeUndefined();

    // --- Invoke: error case ---
    const errResult = await consumer.invoke("/todos/t99", "toggle", {});
    expect(errResult.status).toBe("error");
    expect(errResult.error?.code).toBe("not_found");
  });
});
