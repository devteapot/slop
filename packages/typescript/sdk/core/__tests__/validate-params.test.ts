import { describe, expect, it } from "bun:test";
import { validateParams } from "../src/validate-params";

describe("validateParams", () => {
  it("accepts empty params when schema has no required fields", () => {
    expect(validateParams({ type: "object" }, {})).toBeNull();
    expect(validateParams(undefined, { anything: 1 })).toBeNull();
  });

  it("rejects missing required keys", () => {
    const err = validateParams({ type: "object", required: ["body"] }, {});
    expect(err).toContain("body");
    expect(err).toContain("required");
  });

  it("rejects wrong property type", () => {
    const err = validateParams(
      {
        type: "object",
        properties: { count: { type: "integer" } },
      },
      { count: "not an int" },
    );
    expect(err).toContain("count");
    expect(err).toContain("integer");
  });

  it("rejects enum mismatch", () => {
    const err = validateParams(
      {
        type: "object",
        properties: { status: { type: "string", enum: ["open", "closed"] } },
      },
      { status: "other" },
    );
    expect(err).toContain("status");
  });

  it("accepts enum object member regardless of key order", () => {
    // Python/Go/Rust compare enum members structurally; JS historically used
    // JSON.stringify which is order-sensitive. Make sure we match.
    const err = validateParams(
      {
        type: "object",
        properties: {
          target: {
            type: "object",
            enum: [{ x: 1, y: 2 }],
          },
        },
      },
      { target: { y: 2, x: 1 } },
    );
    expect(err).toBeNull();
  });

  it("validates nested arrays", () => {
    const ok = validateParams(
      {
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" } } },
      },
      { tags: ["a", "b"] },
    );
    expect(ok).toBeNull();

    const err = validateParams(
      {
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" } } },
      },
      { tags: ["a", 2] },
    );
    expect(err).toContain("tags[1]");
  });
});
