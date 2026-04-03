import { afterEach, describe, expect, mock, test } from "bun:test";
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import type { NodeDescriptor, SlopClient } from "@slop-ai/core";
import { Window } from "happy-dom";
import { useSlop } from "../src/index";

const window = new Window();

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

afterEach(() => {
  cleanup();
});

function createMockClient() {
  const registered = new Map<string, NodeDescriptor>();
  const unregistered: string[] = [];

  return {
    registered,
    unregistered,
    register: mock((path: string, desc: NodeDescriptor) => {
      registered.set(path, desc);
    }) as any,
    unregister: mock((path: string) => {
      registered.delete(path);
      unregistered.push(path);
    }) as any,
    scope: mock(() => ({}) as any),
    flush: mock(() => {}),
    stop: mock(() => {}),
  } satisfies SlopClient & { registered: Map<string, NodeDescriptor>; unregistered: string[] };
}

describe("useSlop", () => {
  test("registers after render commit rather than during render", () => {
    const client = createMockClient();
    let renderPhase = false;

    client.register = mock((path: string, desc: NodeDescriptor) => {
      expect(renderPhase).toBe(false);
      client.registered.set(path, desc);
    }) as any;

    function Harness() {
      renderPhase = true;
      useSlop(client, "notes", () => ({ type: "collection", props: { count: 3 } }));
      renderPhase = false;
      return null;
    }

    render(<Harness />);

    expect(client.register).toHaveBeenCalledTimes(1);
    expect(client.register).toHaveBeenCalledWith("notes", {
      type: "collection",
      props: { count: 3 },
    });
  });

  test("supports dynamic paths and unregisters the previous path on change", () => {
    const client = createMockClient();

    function Harness({ path }: { path: string }) {
      useSlop(client, () => path, () => ({ type: "collection", props: { path } }));
      return null;
    }

    const view = render(<Harness path="inbox/messages" />);
    expect(client.registered.has("inbox/messages")).toBe(true);

    view.rerender(<Harness path="archive/messages" />);

    expect(client.registered.has("inbox/messages")).toBe(false);
    expect(client.registered.get("archive/messages")).toEqual({
      type: "collection",
      props: { path: "archive/messages" },
    });
    expect(client.unregistered).toContain("inbox/messages");
  });

  test("unregisters the current path on unmount", () => {
    const client = createMockClient();

    function Harness() {
      useSlop(client, "notes", () => ({ type: "collection" }));
      return null;
    }

    const view = render(<Harness />);
    expect(client.registered.has("notes")).toBe(true);

    view.unmount();

    expect(client.registered.has("notes")).toBe(false);
    expect(client.unregistered).toContain("notes");
  });

  test("re-registers with fresh handler closures after rerender", () => {
    const client = createMockClient();

    function Harness({ value }: { value: number }) {
      useSlop(client, "test", () => ({
        type: "group",
        actions: {
          current: () => value,
        },
      }));
      return null;
    }

    const view = render(<Harness value={1} />);
    view.rerender(<Harness value={2} />);

    const desc = client.registered.get("test");
    const action = desc?.actions?.current as (() => number) | undefined;

    expect(action?.()).toBe(2);
  });

  test("remains stable in StrictMode with a single live registration", () => {
    const client = createMockClient();

    function Harness() {
      useSlop(client, "strict", () => ({ type: "collection" }));
      return null;
    }

    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    expect(client.registered.size).toBe(1);
    expect(client.registered.has("strict")).toBe(true);
    expect(client.register.mock.calls.length).toBeGreaterThanOrEqual(1);

    view.unmount();

    expect(client.registered.size).toBe(0);
    expect(client.unregistered).toContain("strict");
  });
});
