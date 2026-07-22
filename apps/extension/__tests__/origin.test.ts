import { describe, expect, test } from "bun:test";
import { approvalKey, classifyDiscoveryTarget, isLoopbackHostname, pageOriginOf } from "../src/lib/origin";

describe("isLoopbackHostname", () => {
  test("recognizes the loopback family", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("app.localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.1.2.3")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  test("rejects non-loopback hosts", () => {
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isLoopbackHostname("localhost.example.com")).toBe(false);
    expect(isLoopbackHostname("128.0.0.1")).toBe(false);
    expect(isLoopbackHostname("::2")).toBe(false);
  });
});

describe("classifyDiscoveryTarget", () => {
  test("same host is same-origin (port ignored)", () => {
    expect(classifyDiscoveryTarget("https://app.example.com/page", "wss://app.example.com/slop")).toBe("same-origin");
    expect(classifyDiscoveryTarget("https://app.example.com/page", "wss://app.example.com:9000/slop")).toBe(
      "same-origin",
    );
  });

  test("hostname comparison is case-insensitive", () => {
    expect(classifyDiscoveryTarget("https://App.Example.com/", "wss://app.example.COM/slop")).toBe("same-origin");
  });

  test("different host is cross-origin", () => {
    expect(classifyDiscoveryTarget("https://evil.example/", "wss://app.example.com/slop")).toBe("cross-origin");
    expect(classifyDiscoveryTarget("https://app.example.com/", "wss://api.example.com/slop")).toBe("cross-origin");
  });

  test("loopback page declaring a loopback target is same-origin (canonical dev case)", () => {
    expect(classifyDiscoveryTarget("http://localhost:3000/", "ws://localhost:3737/slop")).toBe("same-origin");
    // The loopback family counts as one host
    expect(classifyDiscoveryTarget("http://localhost:3000/", "ws://127.0.0.1:3737/slop")).toBe("same-origin");
    expect(classifyDiscoveryTarget("http://127.0.0.1:3000/", "ws://[::1]:3737/slop")).toBe("same-origin");
  });

  test("loopback target declared by a non-loopback page is cross-origin", () => {
    expect(classifyDiscoveryTarget("https://evil.example/", "ws://127.0.0.1:9339/slop-bridge")).toBe("cross-origin");
    expect(classifyDiscoveryTarget("https://evil.example/", "ws://localhost:3737/slop")).toBe("cross-origin");
    expect(classifyDiscoveryTarget("https://evil.example/", "ws://[::1]:9339/slop")).toBe("cross-origin");
  });

  test("loopback page declaring a remote target is cross-origin", () => {
    expect(classifyDiscoveryTarget("http://localhost:3000/", "wss://api.example.com/slop")).toBe("cross-origin");
  });

  test("unparseable inputs are cross-origin (untrusted by default)", () => {
    expect(classifyDiscoveryTarget("not a url", "ws://localhost:3737/slop")).toBe("cross-origin");
    expect(classifyDiscoveryTarget("https://app.example.com/", "not a url")).toBe("cross-origin");
    expect(classifyDiscoveryTarget("", "")).toBe("cross-origin");
  });
});

describe("pageOriginOf", () => {
  test("returns scheme://host[:port]", () => {
    expect(pageOriginOf("https://app.example.com:8443/deep/path?q=1")).toBe("https://app.example.com:8443");
    expect(pageOriginOf("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  test("returns null for unparseable or opaque origins", () => {
    expect(pageOriginOf("not a url")).toBeNull();
    expect(pageOriginOf("")).toBeNull();
  });
});

describe("approvalKey", () => {
  test("is stable per (page origin, target URL) pair", () => {
    const a = approvalKey("https://app.example.com", "ws://other.example.com/slop");
    const b = approvalKey("https://app.example.com", "ws://other.example.com/slop");
    const c = approvalKey("https://elsewhere.example.com", "ws://other.example.com/slop");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
