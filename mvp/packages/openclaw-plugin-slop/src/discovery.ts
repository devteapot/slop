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
} from "@slop/consumer";

const PROVIDERS_DIR = join(homedir(), ".slop", "providers");

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
  getProviders(): ConnectedProvider[];
  getProvider(id: string): ConnectedProvider | null;
  start(): void;
  stop(): void;
}

export function createDiscoveryService(logger?: { info: (...args: any[]) => void; error: (...args: any[]) => void }): DiscoveryService {
  const log = logger ?? { info: console.log, error: console.error };
  const providers = new Map<string, ConnectedProvider>();
  let watcher: FSWatcher | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;

  function readDescriptors(): ProviderDescriptor[] {
    if (!existsSync(PROVIDERS_DIR)) return [];
    const descriptors: ProviderDescriptor[] = [];
    for (const file of readdirSync(PROVIDERS_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = readFileSync(join(PROVIDERS_DIR, file), "utf-8");
        descriptors.push(JSON.parse(content));
      } catch {}
    }
    return descriptors;
  }

  function createTransport(desc: ProviderDescriptor): ClientTransport | null {
    const t = desc.transport;
    if (t.type === "unix" && t.path) {
      return new NodeSocketClientTransport(t.path);
    }
    if (t.type === "ws" && t.url) {
      return new WebSocketClientTransport(t.url);
    }
    return null;
  }

  async function connectProvider(desc: ProviderDescriptor): Promise<void> {
    if (providers.has(desc.id)) return;

    const transport = createTransport(desc);
    if (!transport) {
      log.info(`[slop] Skipping ${desc.name}: unsupported transport ${desc.transport.type}`);
      return;
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
      log.info(`[slop] Connected to ${entry.name} (${desc.id}) via ${desc.transport.type}`);

      entry.consumer.on("disconnect", () => {
        log.info(`[slop] Disconnected from ${entry.name}`);
        entry.status = "disconnected";
        providers.delete(desc.id);
        // Auto-reconnect after 3 seconds
        setTimeout(() => {
          if (!providers.has(desc.id)) {
            connectProvider(desc).catch(() => {});
          }
        }, 3000);
      });
    } catch (err: any) {
      log.error(`[slop] Failed to connect to ${desc.name}: ${err.message}`);
      providers.delete(desc.id);
    }
  }

  function scan() {
    const descriptors = readDescriptors();
    const currentIds = new Set(providers.keys());
    const scannedIds = new Set(descriptors.map(d => d.id));

    // Connect to new providers
    for (const desc of descriptors) {
      if (!currentIds.has(desc.id)) {
        connectProvider(desc).catch(() => {});
      }
    }

    // Clean up removed providers
    for (const id of currentIds) {
      if (!scannedIds.has(id)) {
        const entry = providers.get(id);
        if (entry) {
          log.info(`[slop] Provider ${entry.name} unregistered, disconnecting`);
          entry.consumer.disconnect();
          providers.delete(id);
        }
      }
    }
  }

  return {
    getProviders() {
      return Array.from(providers.values()).filter(p => p.status === "connected");
    },

    getProvider(id: string) {
      const entry = providers.get(id);
      return entry?.status === "connected" ? entry : null;
    },

    start() {
      scan();

      // Watch for changes in providers directory
      try {
        if (existsSync(PROVIDERS_DIR)) {
          watcher = watch(PROVIDERS_DIR, () => {
            // Debounce with a short delay
            setTimeout(scan, 500);
          });
        }
      } catch {}

      // Fallback: periodic scan every 15 seconds
      scanTimer = setInterval(scan, 15000);
    },

    stop() {
      if (watcher) { watcher.close(); watcher = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      for (const [id, entry] of providers) {
        entry.consumer.disconnect();
      }
      providers.clear();
    },
  };
}
