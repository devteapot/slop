import { describe, test, expect } from "bun:test";
import { pick, omit, action } from "../src/helpers";

describe("pick", () => {
  test("picks specified keys", () => {
    const obj = { a: 1, b: 2, c: 3, d: 4 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  test("ignores missing keys", () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, ["a", "c" as any])).toEqual({ a: 1 });
  });

  test("empty keys returns empty object", () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });

  test("preserves value types", () => {
    const obj = { str: "hello", num: 42, bool: true, arr: [1, 2], obj: { x: 1 } };
    const picked = pick(obj, ["str", "num", "arr"]);
    expect(picked).toEqual({ str: "hello", num: 42, arr: [1, 2] });
  });
});

describe("omit", () => {
  test("removes specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });

  test("returns full object when no keys to omit", () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, [])).toEqual({ a: 1, b: 2 });
  });

  test("handles omitting all keys", () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, ["a", "b"])).toEqual({});
  });

  test("ignores missing keys", () => {
    const obj = { a: 1 };
    expect(omit(obj, ["b" as any])).toEqual({ a: 1 });
  });
});

describe("action", () => {
  test("creates action with typed params and handler", () => {
    const a = action(
      { title: "string", count: "number" },
      ({ title, count }) => {
        // TypeScript should infer: title: string, count: number
        return { title, count };
      }
    );
    expect(typeof a).toBe("object");
    expect((a as any).params).toEqual({ title: "string", count: "number" });
    expect(typeof (a as any).handler).toBe("function");
  });

  test("handler receives params and can use them", () => {
    const a = action(
      { name: "string" },
      ({ name }) => `Hello ${name}`
    );
    const result = (a as any).handler({ name: "World" });
    expect(result).toBe("Hello World");
  });

  test("supports options", () => {
    const a = action(
      { id: "string" },
      () => {},
      { label: "Delete", dangerous: true }
    );
    expect((a as any).label).toBe("Delete");
    expect((a as any).dangerous).toBe(true);
  });

  test("overload: handler with options (no params)", () => {
    const fn = () => {};
    const a = action(fn, { dangerous: true, label: "Remove" });
    expect((a as any).handler).toBe(fn);
    expect((a as any).dangerous).toBe(true);
    expect((a as any).label).toBe("Remove");
  });

  test("action with estimate", () => {
    const a = action(
      { env: "string" },
      () => {},
      { estimate: "async" }
    );
    expect((a as any).estimate).toBe("async");
  });
});
