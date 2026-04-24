import { describe, expect, it } from "bun:test";
import { diffNodes } from "../src/diff";
import { escapeJsonPointerSegment, isValidNodeId, unescapeJsonPointerSegment, validateNodeId } from "../src/paths";

describe("paths — RFC 6901 escape helpers", () => {
  it("escapes / and ~ per RFC 6901", () => {
    expect(escapeJsonPointerSegment("a/b")).toBe("a~1b");
    expect(escapeJsonPointerSegment("a~b")).toBe("a~0b");
    expect(escapeJsonPointerSegment("a/b~c")).toBe("a~1b~0c");
    expect(escapeJsonPointerSegment("~/")).toBe("~0~1");
  });

  it("round-trips escape/unescape", () => {
    for (const s of ["plain", "a/b", "a~b", "a/b~c", "~1 already", "~"]) {
      expect(unescapeJsonPointerSegment(escapeJsonPointerSegment(s))).toBe(s);
    }
  });
});

describe("paths — node id validation", () => {
  it("accepts ordinary ids", () => {
    expect(isValidNodeId("msg-42")).toBe(true);
    expect(isValidNodeId("user.42")).toBe(true);
    expect(() => validateNodeId("msg-42")).not.toThrow();
  });

  it("rejects empty and non-string ids", () => {
    expect(isValidNodeId("")).toBe(false);
    expect(isValidNodeId(42 as unknown)).toBe(false);
  });

  it("rejects reserved keywords", () => {
    for (const kw of ["properties", "children", "affordances", "meta", "content_ref", "id", "type"]) {
      expect(isValidNodeId(kw)).toBe(false);
      expect(() => validateNodeId(kw)).toThrow();
    }
  });

  it("rejects ids containing / or ~", () => {
    expect(isValidNodeId("a/b")).toBe(false);
    expect(isValidNodeId("a~b")).toBe(false);
    expect(() => validateNodeId("a/b")).toThrow();
    expect(() => validateNodeId("a~b")).toThrow();
  });
});

describe("diff — escapes property keys", () => {
  it("escapes property keys that contain / or ~", () => {
    const oldNode = { id: "n", type: "item", properties: {} };
    const newNode = { id: "n", type: "item", properties: { "a/b": 1, "c~d": 2 } };
    const ops = diffNodes(oldNode as any, newNode as any, "");
    const paths = ops.map((o) => o.path).sort();
    expect(paths).toEqual(["/properties/a~1b", "/properties/c~0d"]);
  });
});
