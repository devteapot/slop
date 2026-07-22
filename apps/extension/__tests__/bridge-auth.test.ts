import { describe, expect, test } from "bun:test";
import { BRIDGE_BEARER_PROTOCOL, buildBridgeProtocols, isAcceptedBridgeProtocol } from "../src/lib/bridge-auth";

describe("buildBridgeProtocols", () => {
  test("offers the literal label plus the token", () => {
    expect(buildBridgeProtocols("s3cret-token")).toEqual(["slop.bearer", "s3cret-token"]);
  });

  test("label constant matches the spec", () => {
    expect(BRIDGE_BEARER_PROTOCOL).toBe("slop.bearer");
  });
});

describe("isAcceptedBridgeProtocol", () => {
  test("accepts only the non-secret label echoed by the server", () => {
    expect(isAcceptedBridgeProtocol("slop.bearer")).toBe(true);
  });

  test("rejects anything else (including a token echo or empty selection)", () => {
    expect(isAcceptedBridgeProtocol("")).toBe(false);
    expect(isAcceptedBridgeProtocol("s3cret-token")).toBe(false);
    expect(isAcceptedBridgeProtocol("slop.bearer, s3cret-token")).toBe(false);
  });
});
