import { readFileSync, readdirSync, existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  SlopConsumer,
  WebSocketClientTransport,
  NodeSocketClientTransport,
  formatTree,
  type SlopNode,
  type ClientTransport,
} from "@slop-ai/consumer";

const PROVIDERS_DIR = join(homedir(), ".slop", "providers");
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface ProviderDescriptor {
  id: string;
  name: string;
  slop_version: string;
  transport: {
    type: "unix" | "ws" | "stdio";
    path?: string;
    url?: string;
  };
  pid?: number;
  capabilities: string[];
}

export interface ConnectedProvider {
  id: string;
  name: string;
  descriptor: ProviderDescriptor;
  consumer: SlopConsumer;
  subscriptionId: string;
  status: "connected" | "connecting" | "disconnected";
}

export interface DiscoveryService {
  getDiscovered(): ProviderDescriptor[];
  getProviders(): ConnectedProvider[];
  getProvider(id: string): ConnectedProvider | null;
  ensureConnected(idOrName: string): Promise<ConnectedProvider | null>;
  start(): void;
  stop(): void;
}

export function createDiscoveryService(
  logger?: { info: (...args: any[]) => void; error: (...args: any[]) => void }
): DiscoveryService {
  const log = logger ?? { info: console.log, error: console.error };
  const providers = new Map<string, ConnectedProvider>();
  const lastAccessed = new Map<string, number>();
  const reconnectAttempts = new Map<string, number>();
  const MAX_RECONNECT_DELAY = 30000;
  let watcher: FSWatcher | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let lastDescriptors: ProviderDescriptor[] = [];

  function readDescriptors(): ProviderDescriptor[] {
    if (!existsSync(PROVIDERS_DIR)) return [];
    const descriptors: ProviderDescriptor[] = [];
    for (const file of readdirSync(PROVIDERS_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = readFileSync(join(PROVIDERS_DIR, file), "utf-8");
        descriptors.push(JSON.parse(content));
      } catch (e: any) {
        log.error(`[slop] Failed to parse ${file}: ${e.message}`);
      }
    }
    return descriptors;
  }

  function createTransport(desc: ProviderDescriptor): ClientTransport | null {
    const t = desc.transport;
    if (t.type === "unix" && t.path) return new NodeSocketClientTransport(t.path);
    if (t.type === "ws" && t.url) return new WebSocketClientTransport(t.url);
    return null;
  }

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
      const hello = await entry.consumer.connect();
      entry.name = hello.provider.name;
      const { id: subId } = await entry.consumer.subscribe("/", -1);
      entry.subscriptionId = subId;
      entry.status = "connected";
      lastAccessed.set(desc.id, Date.now());
      reconnectAttempts.delete(desc.id);
      log.info(`[slop] Connected to ${entry.name} (${desc.id}) via ${desc.transport.type}`);

      entry.consumer.on("disconnect", () => {
        log.info(`[slop] Disconnected from ${entry.name}`);
        entry.status = "disconnected";
        providers.delete(desc.id);
        lastAccessed.delete(desc.id);

        // Exponential backoff reconnection (only if descriptor still exists)
        if (lastDescriptors.some(d => d.id === desc.id)) {
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

  function scan() {
    lastDescriptors = readDescriptors();
    const currentIds = new Set(providers.keys());
    const scannedIds = new Set(lastDescriptors.map(d => d.id));

    // Discovery only — no auto-connect. Just clean up stale providers.
    for (const id of currentIds) {
      if (!scannedIds.has(id)) {
        const entry = providers.get(id);
        if (entry) {
          log.info(`[slop] Provider ${entry.name} unregistered, disconnecting`);
          entry.consumer.disconnect();
          providers.delete(id);
          lastAccessed.delete(id);
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

  function findDescriptor(idOrName: string): ProviderDescriptor | null {
    return (
      lastDescriptors.find(d => d.id === idOrName) ??
      lastDescriptors.find(d => d.name.toLowerCase().includes(idOrName.toLowerCase())) ??
      null
    );
  }

  return {
    getDiscovered() {
      return lastDescriptors;
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
      scan();

      try {
        if (existsSync(PROVIDERS_DIR)) {
          watcher = watch(PROVIDERS_DIR, () => setTimeout(scan, 500));
        }
      } catch {}

      scanTimer = setInterval(scan, 15000);
      idleTimer = setInterval(checkIdle, 60000);
    },

    stop() {
      if (watcher) { watcher.close(); watcher = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
      for (const [, entry] of providers) {
        entry.consumer.disconnect();
      }
      providers.clear();
      lastAccessed.clear();
    },
  };
}
