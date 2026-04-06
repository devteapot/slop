import { readFileSync, readdirSync, existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  SlopConsumer,
  WebSocketClientTransport,
  NodeSocketClientTransport,
  type ClientTransport,
} from "@slop-ai/consumer";
import {
  DEFAULT_BRIDGE_URL,
  createBridgeClient,
  type Bridge,
  type BridgeProvider,
} from "./bridge-client";
import {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PATH,
  DEFAULT_BRIDGE_PORT,
  createBridgeServer,
} from "./bridge-server";
import { BridgeRelayTransport } from "./relay-transport";

const DEFAULT_PROVIDERS_DIRS = [
  join(homedir(), ".slop", "providers"),  // persistent user-level
  "/tmp/slop/providers",                   // session-level ephemeral
];
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_SCAN_INTERVAL_MS = 15_000;
const DEFAULT_WATCH_DEBOUNCE_MS = 500;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 3000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_BRIDGE_DIAL_TIMEOUT_MS = 1000;
const DEFAULT_BRIDGE_RETRY_DELAY_MS = 5000;

type Logger = { info: (...args: any[]) => void; error: (...args: any[]) => void };

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
  /** Source: "local" from ~/.slop/providers/ or /tmp/slop/providers/, "bridge" from extension */
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
  logger?: Logger;
  /** Auto-connect all discovered providers instead of lazy-connecting */
  autoConnect?: boolean;
  /** Disable bridge startup entirely (useful for environments that only need local discovery) */
  enableBridge?: boolean;
  /** Disable provider directory watchers and rely on periodic scans only */
  watchProviders?: boolean;
  /** Inject a bridge implementation directly instead of starting one */
  bridge?: Bridge;
  /** Start a bridge server if no existing bridge is found (default: true) */
  hostBridge?: boolean;
  providersDirs?: string[];
  bridgeUrl?: string;
  idleTimeoutMs?: number;
  idleCheckIntervalMs?: number;
  connectTimeoutMs?: number;
  scanIntervalMs?: number;
  watchDebounceMs?: number;
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
  bridgeDialTimeoutMs?: number;
  bridgeRetryDelayMs?: number;
}

export interface DiscoveryService {
  getDiscovered(): ProviderDescriptor[];
  getProviders(): ConnectedProvider[];
  getProvider(id: string): ConnectedProvider | null;
  ensureConnected(idOrName: string): Promise<ConnectedProvider | null>;
  /** Explicitly disconnect from a provider by ID or name. Returns true if found. */
  disconnect(idOrName: string): boolean;
  /** Register a callback fired on connect, disconnect, and state patch */
  onStateChange(fn: () => void): void;
  start(): void;
  stop(): void;
}

export function createDiscoveryService(
  options: DiscoveryOptions = {},
): DiscoveryService {
  const opts = normalizeOptions(options);
  const {
    log,
    autoConnect,
    enableBridge,
    watchProviders,
    bridge: bridgeOverride,
    hostBridge,
    providersDirs,
    bridgeUrl,
    bridgeHost,
    bridgePort,
    bridgePath,
    idleTimeoutMs,
    idleCheckIntervalMs,
    connectTimeoutMs,
    scanIntervalMs,
    watchDebounceMs,
    reconnectBaseDelayMs,
    maxReconnectDelayMs,
    bridgeDialTimeoutMs,
    bridgeRetryDelayMs,
  } = opts;
  const providers = new Map<string, ConnectedProvider>();
  const connecting = new Map<string, Promise<ConnectedProvider | null>>();
  const lastAccessed = new Map<string, number>();
  const reconnectAttempts = new Map<string, number>();
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const intentionalDisconnects = new Set<string>();
  let watchers: FSWatcher[] = [];
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLocalDescriptors: ProviderDescriptor[] = [];
  let bridge: Bridge | null = null;
  let stateChangeCallback: (() => void) | null = null;
  let started = false;
  let lifecycleVersion = 0;

  // --- Local discovery (file-based) ---

  const VALID_TRANSPORT_TYPES = new Set(["unix", "ws", "stdio", "relay"]);

  function isValidDescriptor(obj: unknown): obj is ProviderDescriptor {
    if (typeof obj !== "object" || obj === null) return false;
    const o = obj as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) return false;
    if (typeof o.name !== "string" || !o.name) return false;
    if (typeof o.transport !== "object" || o.transport === null) return false;
    const t = o.transport as Record<string, unknown>;
    if (!VALID_TRANSPORT_TYPES.has(t.type as string)) return false;
    if (!Array.isArray(o.capabilities)) return false;
    return true;
  }

  function readDescriptors(): ProviderDescriptor[] {
    const descriptors: ProviderDescriptor[] = [];
    for (const dir of providersDirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = readFileSync(join(dir, file), "utf-8");
          const desc = JSON.parse(content);
          if (!isValidDescriptor(desc)) {
            log.error(`[slop] Invalid descriptor in ${file}: missing required fields`);
            continue;
          }
          desc.source = "local";
          descriptors.push(desc);
        } catch (e: any) {
          log.error(`[slop] Failed to parse ${file}: ${e.message}`);
        }
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
    const existing = providers.get(desc.id);
    if (existing?.status === "connected") {
      return existing;
    }

    const inFlight = connecting.get(desc.id);
    if (inFlight) {
      return inFlight;
    }

    const generation = lifecycleVersion;
    const trackedPromise = Promise.resolve().then(async () => {
      const transport = createTransport(desc);
      if (!transport) {
        log.info(`[slop] Skipping ${desc.name}: unsupported transport ${desc.transport.type}`);
        return null;
      }

      clearReconnectTimer(desc.id);

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
        const hello = await withTimeout(
          entry.consumer.connect(),
          connectTimeoutMs,
          `Connection timed out after ${Math.round(connectTimeoutMs / 1000)}s`,
        );
        const { id: subId } = await withTimeout(
          entry.consumer.subscribe("/", -1),
          connectTimeoutMs,
          `Subscription timed out after ${Math.round(connectTimeoutMs / 1000)}s`,
        );

        if (lifecycleVersion !== generation || !providers.has(desc.id)) {
          entry.consumer.disconnect();
          return null;
        }

        entry.name = hello.provider.name;
        entry.subscriptionId = subId;
        entry.status = "connected";
        lastAccessed.set(desc.id, Date.now());
        reconnectAttempts.delete(desc.id);
        intentionalDisconnects.delete(desc.id);
        log.info(`[slop] Connected to ${entry.name} (${desc.id}) via ${desc.transport.type}`);
        stateChangeCallback?.();

        entry.consumer.on("patch", () => {
          stateChangeCallback?.();
        });

        entry.consumer.on("disconnect", () => {
          const wasIntentional = intentionalDisconnects.delete(desc.id);
          log.info(`[slop] Disconnected from ${entry.name}`);
          entry.status = "disconnected";
          providers.delete(desc.id);
          lastAccessed.delete(desc.id);
          stateChangeCallback?.();

          if (wasIntentional || lifecycleVersion !== generation) {
            reconnectAttempts.delete(desc.id);
            clearReconnectTimer(desc.id);
            return;
          }

          if (getAllDescriptors().some(d => d.id === desc.id)) {
            const attempt = (reconnectAttempts.get(desc.id) ?? 0) + 1;
            reconnectAttempts.set(desc.id, attempt);
            const delay = Math.min(
              reconnectBaseDelayMs * Math.pow(2, attempt - 1),
              maxReconnectDelayMs,
            );
            log.info(`[slop] Will reconnect to ${entry.name} in ${delay / 1000}s (attempt ${attempt})`);
            clearReconnectTimer(desc.id);
            reconnectTimers.set(desc.id, unrefTimer(setTimeout(() => {
              reconnectTimers.delete(desc.id);
              if (lifecycleVersion === generation && !providers.has(desc.id) && getAllDescriptors().some(d => d.id === desc.id)) {
                void connectProvider(desc).catch(() => {});
              }
            }, delay)));
          }
        });

        return entry;
      } catch (err: any) {
        log.error(`[slop] Failed to connect to ${desc.name}: ${err.message}`);
        providers.delete(desc.id);
        return null;
      }
    }).finally(() => {
      if (connecting.get(desc.id) === trackedPromise) {
        connecting.delete(desc.id);
      }
    });
    connecting.set(desc.id, trackedPromise);
    return trackedPromise;
  }

  // --- Scan & cleanup ---

  function scan() {
    lastLocalDescriptors = readDescriptors();
    const allIds = new Set(getAllDescriptors().map(d => d.id));
    let changed = false;

    // Clean up connected providers whose descriptors are gone
    for (const [id, entry] of providers) {
      if (!allIds.has(id)) {
        log.info(`[slop] Provider ${entry.name} unregistered, disconnecting`);
        markIntentionalDisconnect(id);
        entry.consumer.disconnect();
        providers.delete(id);
        lastAccessed.delete(id);
        reconnectAttempts.delete(id);
        changed = true;
      }
    }

    if (changed) {
      stateChangeCallback?.();
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
      if (now - ts > idleTimeoutMs && providers.has(id)) {
        const entry = providers.get(id)!;
        log.info(`[slop] Idle timeout: disconnecting ${entry.name}`);
        markIntentionalDisconnect(id);
        entry.consumer.disconnect();
        providers.delete(id);
        lastAccessed.delete(id);
        reconnectAttempts.delete(id);
        stateChangeCallback?.();
      }
    }
  }

  // --- Lookup ---

  async function initBridge(
    logger: Logger,
  ): Promise<Bridge> {
    // 1. Try connecting as a client (Desktop or another consumer hosts the bridge)
    const client = createBridgeClient({
      logger,
      url: bridgeUrl,
      reconnectIntervalMs: bridgeRetryDelayMs,
    });
    try {
      await withTimeout(
        client.connectOnce(),
        bridgeDialTimeoutMs,
        `Bridge connection timed out after ${bridgeDialTimeoutMs}ms`,
      );
      client.start(); // enable retry loop for future disconnects
      logger.info("[slop-bridge] Connected as client to existing bridge");
      return client;
    } catch {
      client.stop();
    }

    // 2. If hosting is disabled, just start client with retry loop
    if (!hostBridge) {
      logger.info("[slop-bridge] No bridge found, will keep retrying as client");
      const retryClient = createBridgeClient({
        logger,
        url: bridgeUrl,
        reconnectIntervalMs: bridgeRetryDelayMs,
      });
      retryClient.start();
      return retryClient;
    }

    // 3. No bridge running — start our own server
    const server = createBridgeServer({ logger, host: bridgeHost, port: bridgePort, path: bridgePath });
    try {
      await server.start();
      return server;
    } catch {
      // Port race — another process just took it
      server.stop();
    }

    // 4. Retry as client (port race fallback)
    logger.info("[slop-bridge] Port taken, retrying as client");
    const retryClient = createBridgeClient({
      logger,
      url: bridgeUrl,
      reconnectIntervalMs: bridgeRetryDelayMs,
    });
    retryClient.start();
    return retryClient;
  }

  function scheduleScan() {
    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
    }
    watchDebounceTimer = unrefTimer(setTimeout(() => {
      watchDebounceTimer = null;
      scan();
    }, watchDebounceMs));
  }

  function clearReconnectTimer(id: string) {
    const timer = reconnectTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      reconnectTimers.delete(id);
    }
  }

  function markIntentionalDisconnect(id: string) {
    intentionalDisconnects.add(id);
    clearReconnectTimer(id);
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

    disconnect(idOrName: string): boolean {
      // Find by id
      let entry = providers.get(idOrName);
      let id = idOrName;

      // Find by name
      if (!entry) {
        for (const [pid, p] of providers) {
          if (p.name.toLowerCase().includes(idOrName.toLowerCase())) {
            entry = p;
            id = pid;
            break;
          }
        }
      }

      if (!entry) return false;

      log.info(`[slop] Disconnecting ${entry.name}`);
      markIntentionalDisconnect(id);
      entry.consumer.disconnect();
      providers.delete(id);
      lastAccessed.delete(id);
      reconnectAttempts.delete(id);
      stateChangeCallback?.();
      return true;
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
      if (started) return;
      started = true;
      const generation = ++lifecycleVersion;

      // Start local file discovery
      scan();

      if (watchProviders) {
        for (const dir of providersDirs) {
          try {
            if (existsSync(dir)) {
              watchers.push(watch(dir, scheduleScan));
            }
          } catch {}
        }
      }

      scanTimer = unrefTimer(setInterval(scan, scanIntervalMs));
      idleTimer = unrefTimer(setInterval(checkIdle, idleCheckIntervalMs));

      // Start bridge: use provided bridge, or try client first and fall back to server.
      if (bridgeOverride) {
        bridge = bridgeOverride;
        bridge.start();
        bridge.onProviderChange(() => {
          log.info(`[slop-bridge] Provider list changed (${bridge!.providers().length} browser tabs)`);
          scan();
        });
      } else if (enableBridge) {
        initBridge(log).then((b) => {
          if (!started || lifecycleVersion !== generation) {
            b.stop();
            return;
          }
          bridge = b;
          bridge.onProviderChange(() => {
            log.info(`[slop-bridge] Provider list changed (${bridge!.providers().length} browser tabs)`);
            scan();
          });
        });
      }
    },

    stop() {
      started = false;
      lifecycleVersion += 1;
      for (const w of watchers) w.close();
      watchers = [];
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
      if (watchDebounceTimer) { clearTimeout(watchDebounceTimer); watchDebounceTimer = null; }
      if (bridge) { bridge.stop(); bridge = null; }
      for (const [, promise] of connecting) {
        void promise.catch(() => {});
      }
      connecting.clear();
      for (const [id, timer] of reconnectTimers) {
        markIntentionalDisconnect(id);
        clearTimeout(timer);
      }
      reconnectTimers.clear();
      for (const [, entry] of providers) {
        intentionalDisconnects.add(entry.id);
        entry.consumer.disconnect();
      }
      providers.clear();
      lastAccessed.clear();
      reconnectAttempts.clear();
      intentionalDisconnects.clear();
    },
  };
}

function normalizeOptions(options: DiscoveryOptions = {}) {
  const bridgeUrl = options.bridgeUrl ?? DEFAULT_BRIDGE_URL;
  const bridgeConfig = resolveBridgeConfig(bridgeUrl);

  return {
    log: options.logger ?? { info: console.error, error: console.error },
    autoConnect: options.autoConnect ?? false,
    enableBridge: options.enableBridge ?? true,
    watchProviders: options.watchProviders ?? true,
    bridge: options.bridge ?? null,
    hostBridge: options.hostBridge ?? true,
    providersDirs: options.providersDirs ?? DEFAULT_PROVIDERS_DIRS,
    bridgeUrl,
    bridgeHost: bridgeConfig.host,
    bridgePort: bridgeConfig.port,
    bridgePath: bridgeConfig.path,
    idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    idleCheckIntervalMs: options.idleCheckIntervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS,
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    scanIntervalMs: options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
    watchDebounceMs: options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
    reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
    maxReconnectDelayMs: options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
    bridgeDialTimeoutMs: options.bridgeDialTimeoutMs ?? DEFAULT_BRIDGE_DIAL_TIMEOUT_MS,
    bridgeRetryDelayMs: options.bridgeRetryDelayMs ?? DEFAULT_BRIDGE_RETRY_DELAY_MS,
  };
}

function resolveBridgeConfig(bridgeUrl: string) {
  try {
    const parsed = new URL(bridgeUrl);
    return {
      host: parsed.hostname || DEFAULT_BRIDGE_HOST,
      port: parsed.port ? Number(parsed.port) : DEFAULT_BRIDGE_PORT,
      path: parsed.pathname || DEFAULT_BRIDGE_PATH,
    };
  } catch {
    return {
      host: DEFAULT_BRIDGE_HOST,
      port: DEFAULT_BRIDGE_PORT,
      path: DEFAULT_BRIDGE_PATH,
    };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      unrefTimer(setTimeout(() => reject(new Error(message)), timeoutMs));
    }),
  ]);
}

function unrefTimer<T extends { unref?: () => unknown }>(timer: T): T {
  timer.unref?.();
  return timer;
}
