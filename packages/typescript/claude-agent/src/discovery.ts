import { readFileSync, readdirSync, existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  SlopConsumer,
  WebSocketClientTransport,
  NodeSocketClientTransport,
  type ClientTransport,
} from "@slop-ai/consumer";
import { createBridgeClient, type Bridge, type BridgeProvider } from "./bridge-client";
import { createBridgeServer } from "./bridge-server";
import { BridgeRelayTransport } from "./relay-transport";

const PROVIDERS_DIR = join(homedir(), ".slop", "providers");
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface ProviderDescriptor {
  id: string;
  name: string;
  slop_version: string;
  transport: {
    type: "unix" | "ws" | "stdio" | "relay";
    path?: string;
    url?: string;
  };
  pid?: number;
  capabilities: string[];
  /** Bridge provider key (for browser tab providers) */
  providerKey?: string;
  /** Source: "local" from ~/.slop/providers/, "bridge" from extension */
  source?: "local" | "bridge";
}

export interface ConnectedProvider {
  id: string;
  name: string;
  descriptor: ProviderDescriptor;
  consumer: SlopConsumer;
  subscriptionId: string;
  status: "connected" | "connecting" | "disconnected";
}

export interface DiscoveryOptions {
  logger?: { info: (...args: any[]) => void; error: (...args: any[]) => void };
  /** Auto-connect all discovered providers instead of lazy-connecting */
  autoConnect?: boolean;
}

export interface DiscoveryService {
  getDiscovered(): ProviderDescriptor[];
  getProviders(): ConnectedProvider[];
  getProvider(id: string): ConnectedProvider | null;
  ensureConnected(idOrName: string): Promise<ConnectedProvider | null>;
  /** Register a callback fired on connect, disconnect, and state patch */
  onStateChange(fn: () => void): void;
  start(): void;
  stop(): void;
}

export function createDiscoveryService(
  optionsOrLogger?: DiscoveryOptions | { info: (...args: any[]) => void; error: (...args: any[]) => void }
): DiscoveryService {
  // Support both old signature (logger) and new (options)
  const opts: DiscoveryOptions =
    optionsOrLogger && ("autoConnect" in optionsOrLogger || "logger" in optionsOrLogger)
      ? optionsOrLogger as DiscoveryOptions
      : { logger: optionsOrLogger as any };
  const log = opts.logger ?? { info: console.error, error: console.error };
  const autoConnect = opts.autoConnect ?? false;
  const providers = new Map<string, ConnectedProvider>();
  const lastAccessed = new Map<string, number>();
  const reconnectAttempts = new Map<string, number>();
  const MAX_RECONNECT_DELAY = 30000;
  let watcher: FSWatcher | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let lastLocalDescriptors: ProviderDescriptor[] = [];
  let bridge: Bridge | null = null;
  let stateChangeCallback: (() => void) | null = null;

  // --- Local discovery (file-based) ---

  function readDescriptors(): ProviderDescriptor[] {
    if (!existsSync(PROVIDERS_DIR)) return [];
    const descriptors: ProviderDescriptor[] = [];
    for (const file of readdirSync(PROVIDERS_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = readFileSync(join(PROVIDERS_DIR, file), "utf-8");
        const desc = JSON.parse(content);
        desc.source = "local";
        descriptors.push(desc);
      } catch (e: any) {
        log.error(`[slop] Failed to parse ${file}: ${e.message}`);
      }
    }
    return descriptors;
  }

  // --- Bridge discovery (browser tabs via extension) ---

  function getBridgeDescriptors(): ProviderDescriptor[] {
    if (!bridge?.running()) return [];
    return bridge.providers().map(bridgeProviderToDescriptor);
  }

  function bridgeProviderToDescriptor(bp: BridgeProvider): ProviderDescriptor {
    // WS providers from the bridge can be connected directly
    // postMessage providers need the relay transport
    const transport =
      bp.transport === "ws" && bp.url
        ? { type: "ws" as const, url: bp.url }
        : { type: "relay" as const };

    return {
      id: bp.providerKey,
      name: bp.name,
      slop_version: "1.0",
      transport,
      capabilities: [],
      providerKey: bp.providerKey,
      source: "bridge",
    };
  }

  // --- Merged discovery ---

  function getAllDescriptors(): ProviderDescriptor[] {
    return [...lastLocalDescriptors, ...getBridgeDescriptors()];
  }

  // --- Transport creation ---

  function createTransport(desc: ProviderDescriptor): ClientTransport | null {
    const t = desc.transport;
    if (t.type === "unix" && t.path) return new NodeSocketClientTransport(t.path);
    if (t.type === "ws" && t.url) return new WebSocketClientTransport(t.url);
    if (t.type === "relay" && desc.providerKey && bridge) {
      return new BridgeRelayTransport(bridge, desc.providerKey);
    }
    return null;
  }

  // --- Connection management ---

  async function connectProvider(desc: ProviderDescriptor): Promise<ConnectedProvider | null> {
    if (providers.has(desc.id) && providers.get(desc.id)!.status === "connected") {
      return providers.get(desc.id)!;
    }

    const transport = createTransport(desc);
    if (!transport) {
      log.info(`[slop] Skipping ${desc.name}: unsupported transport ${desc.transport.type}`);
      return null;
    }

    const entry: ConnectedProvider = {
      id: desc.id,
      name: desc.name,
      descriptor: desc,
      consumer: new SlopConsumer(transport),
      subscriptionId: "",
      status: "connecting",
    };
    providers.set(desc.id, entry);

    try {
      const CONNECT_TIMEOUT = 10_000;
      const hello = await Promise.race([
        entry.consumer.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Connection timed out after 10s")), CONNECT_TIMEOUT),
        ),
      ]);
      entry.name = hello.provider.name;
      const { id: subId } = await entry.consumer.subscribe("/", -1);
      entry.subscriptionId = subId;
      entry.status = "connected";
      lastAccessed.set(desc.id, Date.now());
      reconnectAttempts.delete(desc.id);
      log.info(`[slop] Connected to ${entry.name} (${desc.id}) via ${desc.transport.type}`);
      stateChangeCallback?.();

      entry.consumer.on("patch", () => {
        stateChangeCallback?.();
      });

      entry.consumer.on("disconnect", () => {
        log.info(`[slop] Disconnected from ${entry.name}`);
        entry.status = "disconnected";
        providers.delete(desc.id);
        lastAccessed.delete(desc.id);
        stateChangeCallback?.();

        // Exponential backoff reconnection (only if descriptor still exists)
        const allDescs = getAllDescriptors();
        if (allDescs.some(d => d.id === desc.id)) {
          const attempt = (reconnectAttempts.get(desc.id) ?? 0) + 1;
          reconnectAttempts.set(desc.id, attempt);
          const delay = Math.min(3000 * Math.pow(2, attempt - 1), MAX_RECONNECT_DELAY);
          log.info(`[slop] Will reconnect to ${entry.name} in ${delay / 1000}s (attempt ${attempt})`);
          setTimeout(() => {
            if (!providers.has(desc.id)) {
              connectProvider(desc).catch(() => {});
            }
          }, delay);
        }
      });

      return entry;
    } catch (err: any) {
      log.error(`[slop] Failed to connect to ${desc.name}: ${err.message}`);
      providers.delete(desc.id);
      return null;
    }
  }

  // --- Scan & cleanup ---

  function scan() {
    lastLocalDescriptors = readDescriptors();
    const allIds = new Set(getAllDescriptors().map(d => d.id));

    // Clean up connected providers whose descriptors are gone
    for (const [id, entry] of providers) {
      if (!allIds.has(id)) {
        log.info(`[slop] Provider ${entry.name} unregistered, disconnecting`);
        entry.consumer.disconnect();
        providers.delete(id);
        lastAccessed.delete(id);
      }
    }

    // Auto-connect new providers when in plugin mode
    if (autoConnect) {
      const allDescs = getAllDescriptors();
      for (const desc of allDescs) {
        if (!providers.has(desc.id)) {
          connectProvider(desc).catch(() => {});
        }
      }
    }
  }

  function checkIdle() {
    const now = Date.now();
    for (const [id, ts] of lastAccessed) {
      if (now - ts > IDLE_TIMEOUT && providers.has(id)) {
        const entry = providers.get(id)!;
        log.info(`[slop] Idle timeout: disconnecting ${entry.name}`);
        entry.consumer.disconnect();
        providers.delete(id);
        lastAccessed.delete(id);
        reconnectAttempts.delete(id);
      }
    }
  }

  // --- Lookup ---

  async function initBridge(
    logger: { info: (...args: any[]) => void; error: (...args: any[]) => void },
  ): Promise<Bridge> {
    // 1. Try connecting as a client (Desktop or another consumer hosts the bridge)
    const client = createBridgeClient(logger);
    try {
      await client.connectOnce();
      client.start(); // enable retry loop for future disconnects
      logger.info("[slop-bridge] Connected as client to existing bridge");
      return client;
    } catch {
      client.stop();
    }

    // 2. No bridge running — start our own server
    const server = createBridgeServer(logger);
    try {
      await server.start();
      return server;
    } catch {
      // Port race — another process just took it
      server.stop();
    }

    // 3. Retry as client (port race fallback)
    logger.info("[slop-bridge] Port taken, retrying as client");
    const retryClient = createBridgeClient(logger);
    retryClient.start();
    return retryClient;
  }

  function findDescriptor(idOrName: string): ProviderDescriptor | null {
    const all = getAllDescriptors();
    return (
      all.find(d => d.id === idOrName) ??
      all.find(d => d.name.toLowerCase().includes(idOrName.toLowerCase())) ??
      null
    );
  }

  return {
    onStateChange(fn: () => void) {
      stateChangeCallback = fn;
    },

    getDiscovered() {
      return getAllDescriptors();
    },

    getProviders() {
      return Array.from(providers.values()).filter(p => p.status === "connected");
    },

    getProvider(id: string) {
      const entry = providers.get(id);
      if (entry?.status === "connected") {
        lastAccessed.set(id, Date.now());
        return entry;
      }
      return null;
    },

    async ensureConnected(idOrName: string): Promise<ConnectedProvider | null> {
      // Check if already connected
      const existing = providers.get(idOrName);
      if (existing?.status === "connected") {
        lastAccessed.set(idOrName, Date.now());
        return existing;
      }

      // Search by name in connected providers
      for (const [id, entry] of providers) {
        if (entry.status === "connected" && entry.name.toLowerCase().includes(idOrName.toLowerCase())) {
          lastAccessed.set(id, Date.now());
          return entry;
        }
      }

      // Find in discovered descriptors and connect
      const desc = findDescriptor(idOrName);
      if (!desc) return null;

      const connected = await connectProvider(desc);
      return connected;
    },

    start() {
      // Start local file discovery
      scan();

      try {
        if (existsSync(PROVIDERS_DIR)) {
          watcher = watch(PROVIDERS_DIR, () => setTimeout(scan, 500));
        }
      } catch {}

      scanTimer = setInterval(scan, 15000);
      idleTimer = setInterval(checkIdle, 60000);

      // Start bridge: try client first, fall back to server
      initBridge(log).then((b) => {
        bridge = b;
        bridge.onProviderChange(() => {
          log.info(`[slop-bridge] Provider list changed (${bridge!.providers().length} browser tabs)`);
          if (autoConnect) {
            for (const desc of getBridgeDescriptors()) {
              if (!providers.has(desc.id)) {
                connectProvider(desc).catch(() => {});
              }
            }
          }
        });
      });
    },

    stop() {
      if (watcher) { watcher.close(); watcher = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
      if (bridge) { bridge.stop(); bridge = null; }
      for (const [, entry] of providers) {
        entry.consumer.disconnect();
      }
      providers.clear();
      lastAccessed.clear();
    },
  };
}
