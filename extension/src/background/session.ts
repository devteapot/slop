import type { SlopNode } from "@slop-ai/consumer/browser";
import {
  SlopConsumer,
  WebSocketClientTransport,
  PostMessageClientTransport,
} from "@slop-ai/consumer/browser";
import type { ProviderSpec, BackgroundMessage } from "../types";

export interface ProviderEntry {
  name: string; // "data" for ws, "ui" for postmessage
  transport: "ws" | "postmessage";
  endpoint?: string;
  consumer: SlopConsumer | null;
  subscriptionId: string | null;
  tree: SlopNode | null;
  status: "disconnected" | "connecting" | "connected";
}

type StatusHandler = () => void;
type TreeHandler = () => void;

export class Session {
  providers: ProviderEntry[] = [];
  providerName = "";

  private port: chrome.runtime.Port;
  private tabId: number;
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onStatusChange: StatusHandler;
  private onTreeUpdate: TreeHandler;

  constructor(
    tabId: number,
    port: chrome.runtime.Port,
    onStatusChange: StatusHandler,
    onTreeUpdate: TreeHandler,
  ) {
    this.tabId = tabId;
    this.port = port;
    this.onStatusChange = onStatusChange;
    this.onTreeUpdate = onTreeUpdate;
  }

  async connect(specs: ProviderSpec[]): Promise<void> {
    this.providers = specs.map((s) => ({
      name: s.transport === "ws" ? "data" : "ui",
      transport: s.transport,
      endpoint: s.endpoint,
      consumer: null,
      subscriptionId: null,
      tree: null,
      status: "disconnected" as const,
    }));

    for (const entry of this.providers) {
      this.connectProvider(entry);
    }
  }

  disconnect(): void {
    for (const entry of this.providers) {
      if (entry.consumer) {
        entry.consumer.disconnect();
        entry.consumer = null;
      }
      this.cancelReconnect(entry.name);
    }
    this.providers = [];
  }

  async sync(specs: ProviderSpec[]): Promise<void> {
    const keyFor = (s: { transport: string; endpoint?: string }) =>
      `${s.transport}:${s.endpoint ?? ""}`;

    const nextKeys = new Set(specs.map(keyFor));

    // Remove providers no longer present
    for (const entry of [...this.providers]) {
      if (!nextKeys.has(keyFor(entry))) {
        if (entry.consumer) {
          entry.consumer.disconnect();
          entry.consumer = null;
        }
        this.cancelReconnect(entry.name);
        this.providers = this.providers.filter((p) => p !== entry);
      }
    }

    // Add new providers
    for (const spec of specs) {
      const exists = this.providers.some((p) => keyFor(p) === keyFor(spec));
      if (exists) continue;

      const entry: ProviderEntry = {
        name: spec.transport === "ws" ? "data" : "ui",
        transport: spec.transport,
        endpoint: spec.endpoint,
        consumer: null,
        subscriptionId: null,
        tree: null,
        status: "disconnected",
      };
      this.providers.push(entry);
      this.connectProvider(entry);
    }

    this.onStatusChange();
  }

  getStatus(): "disconnected" | "connecting" | "connected" {
    if (this.providers.some((p) => p.status === "connected")) return "connected";
    if (this.providers.some((p) => p.status === "connecting")) return "connecting";
    return "disconnected";
  }

  getMergedTree(): SlopNode | null {
    const connected = this.providers
      .filter((p) => p.tree && p.status === "connected")
      .map((p) => ({ ...p.tree!, id: p.name }));

    if (connected.length === 0) return null;
    if (connected.length === 1) return connected[0];

    return { id: "root", type: "root", children: connected };
  }

  getProviderByIndex(index: number): ProviderEntry | undefined {
    return this.providers[index];
  }

  getConnectedProviders(): Array<{ entry: ProviderEntry; index: number }> {
    return this.providers
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.consumer && entry.status === "connected");
  }

  private async connectProvider(entry: ProviderEntry): Promise<void> {
    entry.status = "connecting";
    this.onStatusChange();

    try {
      const transport = entry.transport === "ws"
        ? new WebSocketClientTransport(entry.endpoint!)
        : new PostMessageClientTransport(this.port);

      const consumer = new SlopConsumer(transport);
      const hello = await consumer.connect();
      const { id: subId, snapshot } = await consumer.subscribe("/", -1);

      entry.consumer = consumer;
      entry.subscriptionId = subId;
      entry.tree = snapshot;
      entry.status = "connected";

      if (!this.providerName) {
        this.providerName = hello.provider.name;
      }

      this.onStatusChange();
      this.onTreeUpdate();

      consumer.on("patch", () => {
        entry.tree = consumer.getTree(subId);
        this.onTreeUpdate();
      });

      consumer.on("disconnect", () => {
        entry.status = "disconnected";
        entry.consumer = null;
        entry.subscriptionId = null;
        this.onStatusChange();
        this.scheduleReconnect(entry);
      });
    } catch (err) {
      console.error(`[session] connect failed for ${entry.name}:`, err);
      entry.status = "disconnected";
      this.onStatusChange();
      this.scheduleReconnect(entry);
    }
  }

  private scheduleReconnect(entry: ProviderEntry): void {
    this.cancelReconnect(entry.name);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(entry.name);
      if (entry.status === "disconnected") {
        this.connectProvider(entry);
      }
    }, 2000);
    this.reconnectTimers.set(entry.name, timer);
  }

  private cancelReconnect(name: string): void {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
  }
}
