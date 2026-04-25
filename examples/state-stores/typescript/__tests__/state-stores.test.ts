import { describe, expect, test } from "bun:test";
import type { SlopClient, SlopNode } from "@slop-ai/client";
import {
  createJotaiExample,
  createMobxExample,
  createReduxToolkitExample,
  createValtioExample,
  createZustandExample,
  type TodoExample,
} from "../src";

interface TestSlopClient extends SlopClient {
  getTree(): SlopNode;
  executeInvoke(message: {
    id: string;
    path: string;
    action: string;
    params?: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

const exampleFactories: Array<{
  name: string;
  create: () => TodoExample;
}> = [
  { name: "Zustand", create: createZustandExample },
  { name: "Redux Toolkit", create: createReduxToolkitExample },
  { name: "Jotai", create: createJotaiExample },
  { name: "MobX", create: createMobxExample },
  { name: "Valtio", create: createValtioExample },
];

describe("state store examples", () => {
  for (const { name, create } of exampleFactories) {
    test(`${name} exposes native state updates and SLOP actions`, async () => {
      const example = create();
      const slop = example.slop as TestSlopClient;

      expect(todosNode(slop)?.properties).toEqual({
        count: 0,
        done: 0,
        open: 0,
      });

      const nativeTodo = example.addTodo("Ship runnable examples");
      await waitForStoreEmission();
      expect(todosNode(slop)?.properties).toEqual({
        count: 1,
        done: 0,
        open: 1,
      });

      await invoke(slop, `/todos/${nativeTodo.id}`, "toggle");
      expect(example.getTodos()).toContainEqual({
        ...nativeTodo,
        done: true,
      });
      expect(todosNode(slop)?.properties).toEqual({
        count: 1,
        done: 1,
        open: 0,
      });

      await invoke(slop, "/todos", "clear_done");
      expect(example.getTodos()).toEqual([]);
      expect(todosNode(slop)?.properties).toEqual({
        count: 0,
        done: 0,
        open: 0,
      });

      await invoke(slop, "/todos", "create", { title: "Created through SLOP" });
      expect(example.getTodos()[0]).toMatchObject({ title: "Created through SLOP", done: false });
      expect(todosNode(slop)?.properties).toEqual({
        count: 1,
        done: 0,
        open: 1,
      });

      example.dispose();
      slop.flush();
      expect(todosNode(slop)).toBeUndefined();
    });
  }
});

async function invoke(
  slop: TestSlopClient,
  path: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<void> {
  const result = await slop.executeInvoke({
    id: `${action}-test`,
    path,
    action,
    params,
  });
  expect(result).toMatchObject({
    type: "result",
    status: "ok",
  });
}

function todosNode(slop: TestSlopClient): SlopNode | undefined {
  slop.flush();
  return slop.getTree().children?.find((node) => node.id === "todos");
}

async function waitForStoreEmission(): Promise<void> {
  await Promise.resolve();
}
