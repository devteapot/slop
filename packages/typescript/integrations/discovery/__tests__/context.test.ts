import { describe, expect, test } from "bun:test";
import type { SlopNode } from "@slop-ai/consumer";
import { buildSlopAvailableAppsTail, buildSlopContext, buildSlopStateTail } from "../src/context";
import type { ConnectedProvider, DiscoveryService, ProviderDescriptor } from "../src/discovery";

const FIXED_TS = "2026-04-28T10:30:00.000Z";

function descriptor(id: string, name: string, capabilities: string[] = []): ProviderDescriptor {
  return {
    id,
    name,
    slop_version: "1.0",
    transport: { type: "ws", url: `ws://example/${id}` },
    capabilities,
    source: "local",
  };
}

function makeProvider(id: string, name: string, tree: SlopNode | null): ConnectedProvider {
  const desc = descriptor(id, name);
  const fakeConsumer = {
    getTree: (_subId: string) => tree,
  } as unknown as ConnectedProvider["consumer"];
  return {
    id,
    name,
    descriptor: desc,
    consumer: fakeConsumer,
    subscriptionId: "sub-1",
    status: "connected",
  };
}

function fakeDiscovery(opts: {
  connected?: ConnectedProvider[];
  discovered?: ProviderDescriptor[];
}): DiscoveryService {
  const connected = opts.connected ?? [];
  const discovered = opts.discovered ?? connected.map((p) => p.descriptor);
  return {
    getDiscovered: () => discovered,
    getProviders: () => connected,
    getProvider: (id) => connected.find((p) => p.id === id) ?? null,
    ensureConnected: async () => null,
    disconnect: () => false,
    onStateChange: () => {},
    start: () => {},
    stop: () => {},
  };
}

const sampleTree: SlopNode = {
  id: "mail-app",
  type: "root",
  properties: { label: "Mail" },
  children: [],
};

describe("buildSlopStateTail", () => {
  test("connected provider with tree appears only in the state tail", () => {
    const provider = makeProvider("mail", "Mail", sampleTree);
    const discovery = fakeDiscovery({ connected: [provider] });
    const out = buildSlopStateTail(discovery, { generatedAt: FIXED_TS });
    expect(out).not.toBeNull();
    expect(out).toContain("Mail (mail)");
    expect(out).toContain("[root] mail-app");
  });

  test("connected provider awaiting snapshot is rendered as awaiting", () => {
    const provider = makeProvider("mail", "Mail", null);
    const discovery = fakeDiscovery({ connected: [provider] });
    const out = buildSlopStateTail(discovery, { generatedAt: FIXED_TS });
    expect(out).toContain("(awaiting snapshot)");
  });

  test("returns null when no providers are connected", () => {
    const discovery = fakeDiscovery({});
    expect(buildSlopStateTail(discovery)).toBeNull();
  });
});

describe("buildSlopAvailableAppsTail", () => {
  test("only unconnected discovered apps appear in the catalog", () => {
    const connected = makeProvider("mail", "Mail", sampleTree);
    const discovery = fakeDiscovery({
      connected: [connected],
      discovered: [connected.descriptor, descriptor("calendar", "Calendar", ["events"])],
    });
    const out = buildSlopAvailableAppsTail(discovery, { generatedAt: FIXED_TS });
    expect(out).not.toBeNull();
    expect(out).toContain("Calendar (id: `calendar`, ws, local)");
    expect(out).toContain("capabilities: events");
    expect(out).not.toContain("Mail (id: `mail`");
  });

  test("returns null when every discovered app is already connected", () => {
    const provider = makeProvider("mail", "Mail", sampleTree);
    const discovery = fakeDiscovery({ connected: [provider] });
    expect(buildSlopAvailableAppsTail(discovery)).toBeNull();
  });
});

describe("buildSlopStateTail projection", () => {
  test("projectTree is applied before rendering", () => {
    const provider = makeProvider("mail", "Mail", sampleTree);
    const discovery = fakeDiscovery({ connected: [provider] });
    const projected: SlopNode = {
      id: "filtered",
      type: "root",
      properties: { label: "Filtered" },
    };
    const out = buildSlopStateTail(discovery, {
      generatedAt: FIXED_TS,
      projectTree: () => projected,
    });
    expect(out).toContain("[root] filtered");
    expect(out).not.toContain("[root] mail-app");
  });
});

describe("buildSlopContext", () => {
  test("returns both tails in one call", () => {
    const provider = makeProvider("mail", "Mail", sampleTree);
    const discovery = fakeDiscovery({
      connected: [provider],
      discovered: [provider.descriptor, descriptor("calendar", "Calendar")],
    });
    const ctx = buildSlopContext(discovery, { generatedAt: FIXED_TS });
    expect(ctx.stateTail).toContain("<slop-state");
    expect(ctx.availableAppsTail).toContain("<slop-apps-available");
  });

  test("empty discovery returns null on both", () => {
    const ctx = buildSlopContext(fakeDiscovery({}));
    expect(ctx.stateTail).toBeNull();
    expect(ctx.availableAppsTail).toBeNull();
  });
});
