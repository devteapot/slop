import type { PatchOp, ResultMessage } from "@slop-ai/consumer";
import {
  type ConnectedProvider,
  createDiscoveryService,
  type DiscoveryOptions,
  type DiscoveryService,
  type ProviderDescriptor,
} from "@slop-ai/discovery/service";
import { type Down, isPlainRecord, type Logger, type ProviderSummary, type Up } from "./protocol";
import { createRelayClient, type RelayClient, type RelayClientOptions } from "./relay-client";

export interface RelayBridgeOptions {
  url: string;
  token: string;
  relayVersion: string;
  discoveryOptions?: DiscoveryOptions;
  discovery?: DiscoveryService;
  client?: RelayClient;
  logger?: Logger;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  stableConnectionMs?: number;
}

export interface RelayBridge {
  start(): void;
  stop(): void;
}

type PatchListener = (subscriptionId: string, ops: PatchOp[], version: number) => void;

interface ActiveSubscription {
  provider: ConnectedProvider;
  listener: PatchListener;
}

const noopLogger: Logger = { info: () => {}, error: () => {} };

export function createRelayBridge(options: RelayBridgeOptions): RelayBridge {
  const logger = options.logger ?? noopLogger;
  const discovery =
    options.discovery ??
    createDiscoveryService({
      autoConnect: false,
      watchProviders: true,
      ...options.discoveryOptions,
      logger,
    });
  const client =
    options.client ??
    createRelayClient({
      url: options.url,
      token: options.token,
      relayVersion: options.relayVersion,
      logger,
      reconnectBaseDelayMs: options.reconnectBaseDelayMs,
      reconnectMaxDelayMs: options.reconnectMaxDelayMs,
      stableConnectionMs: options.stableConnectionMs,
    } satisfies RelayClientOptions);
  const subscriptions = new Map<string, ActiveSubscription>();

  const sendProviders = () => {
    client.send({ t: "providers", list: summarizeProviders(discovery) });
  };

  const onFrame = (frame: Down) => {
    void handleFrame(frame).catch((error) => {
      logger.error("[slop-relay] Bridge frame failed:", error instanceof Error ? error.message : String(error));
    });
  };

  async function handleFrame(frame: Down): Promise<void> {
    switch (frame.t) {
      case "subscribe":
        await handleSubscribe(frame);
        break;
      case "unsubscribe":
        handleUnsubscribe(frame.subId);
        break;
      case "invoke":
        await handleInvoke(frame);
        break;
      case "ping":
        break;
    }
  }

  async function handleSubscribe(frame: Extract<Down, { t: "subscribe" }>): Promise<void> {
    handleUnsubscribe(frame.subId);
    const provider = await discovery.ensureConnected(frame.providerId);
    if (!provider) {
      sendError(frame.reqId, "provider_unavailable", `Provider "${frame.providerId}" is not available.`);
      return;
    }

    const tree = provider.consumer.getTree(provider.subscriptionId);
    if (!tree) {
      sendError(frame.reqId, "snapshot_unavailable", "Provider has not delivered an initial snapshot yet.");
      return;
    }

    client.send({ t: "snapshot", reqId: frame.reqId, subId: frame.subId, tree });

    const listener: PatchListener = (subscriptionId, ops, version) => {
      if (subscriptionId !== provider.subscriptionId) return;
      client.send({ t: "patch", subId: frame.subId, ops, version });
    };
    provider.consumer.on("patch", listener);
    subscriptions.set(frame.subId, { provider, listener });
  }

  function handleUnsubscribe(subId: string): void {
    const active = subscriptions.get(subId);
    if (!active) return;
    active.provider.consumer.off("patch", active.listener);
    subscriptions.delete(subId);
  }

  async function handleInvoke(frame: Extract<Down, { t: "invoke" }>): Promise<void> {
    if (frame.params !== undefined && !isPlainRecord(frame.params)) {
      sendError(frame.reqId, "invalid_params", "Invoke params must be an object when provided.");
      return;
    }

    const provider = await discovery.ensureConnected(frame.providerId);
    if (!provider) {
      sendError(frame.reqId, "provider_unavailable", `Provider "${frame.providerId}" is not available.`);
      return;
    }

    try {
      const result = await provider.consumer.invoke(frame.path, frame.action, frame.params ?? {});
      client.send(resultToFrame(frame.reqId, result));
    } catch (error) {
      sendError(frame.reqId, "invoke_failed", error instanceof Error ? error.message : String(error));
    }
  }

  function sendError(reqId: string, code: string, message: string): void {
    client.send({ t: "result", reqId, ok: false, error: { code, message } });
  }

  return {
    start() {
      discovery.onStateChange(sendProviders);
      client.on("frame", onFrame);
      client.on("open", sendProviders);
      discovery.start();
      sendProviders();
      client.start();
    },
    stop() {
      for (const subId of [...subscriptions.keys()]) {
        handleUnsubscribe(subId);
      }
      client.off("frame", onFrame);
      client.off("open", sendProviders);
      client.stop();
      discovery.stop();
    },
  };
}

export function summarizeProviders(
  discovery: Pick<DiscoveryService, "getDiscovered" | "getProviders">,
): ProviderSummary[] {
  const connected = discovery.getProviders();
  const connectedById = new Map(connected.map((provider) => [provider.id, provider]));
  const summaries: ProviderSummary[] = [];
  const seen = new Set<string>();

  for (const descriptor of discovery.getDiscovered()) {
    const provider = connectedById.get(descriptor.id);
    summaries.push(summaryFromDescriptor(descriptor, provider));
    seen.add(descriptor.id);
  }

  for (const provider of connected) {
    if (seen.has(provider.id)) continue;
    summaries.push({
      id: provider.id,
      name: provider.name,
      transport: provider.descriptor.transport.type,
      source: provider.descriptor.source ?? "local",
      status: provider.status,
      capabilities: provider.descriptor.capabilities,
    });
  }

  return summaries;
}

function summaryFromDescriptor(
  descriptor: ProviderDescriptor,
  provider: ConnectedProvider | undefined,
): ProviderSummary {
  return {
    id: descriptor.id,
    name: provider?.name ?? descriptor.name,
    transport: descriptor.transport.type,
    source: descriptor.source ?? "local",
    status: provider?.status ?? "disconnected",
    capabilities: descriptor.capabilities,
  };
}

function resultToFrame(reqId: string, result: ResultMessage): Up {
  if (result.status === "error") {
    return {
      t: "result",
      reqId,
      ok: false,
      error: {
        code: result.error?.code ?? "error",
        message: result.error?.message ?? "(no message)",
      },
    };
  }
  return {
    t: "result",
    reqId,
    ok: true,
    ...(result.data !== undefined && { data: result.data }),
  };
}
