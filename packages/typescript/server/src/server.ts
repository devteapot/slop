import { ProviderBase, diffNodes } from "@slop-ai/core";
import type {
  SlopNode, PatchOp, ActionHandler, NodeDescriptor,
  SlopClientOptions, SubscriptionFilter,
} from "@slop-ai/core";

/** A descriptor function that returns a NodeDescriptor when called. */
export type DescriptorFn = () => NodeDescriptor;

/** A connected consumer. */
export interface Connection {
  send(message: unknown): void;
  close(): void;
}

/** A subscription from a consumer. */
interface Subscription {
  id: string;
  path: string;
  depth: number;
  filter?: SubscriptionFilter;
  connection: Connection;
  /** Last output tree sent to this subscriber (for diffing). */
  lastTree: SlopNode | null;
}

export interface SlopServerOptions<S = unknown> extends SlopClientOptions<S> {}

/**
 * Server-side SLOP provider. Extends ProviderBase with:
 * - Multiple simultaneous consumer connections
 * - Descriptor functions (re-evaluated on refresh)
 * - Eager rebuild (no microtask batching)
 * - Auto-refresh after invoke
 * - Change listeners
 */
export class SlopServer<S = unknown> extends ProviderBase<S> {
  readonly id: string;
  readonly name: string;

  private dynamicRegistrations = new Map<string, DescriptorFn>();
  private staticRegistrations = new Map<string, NodeDescriptor>();
  private subscriptions: Subscription[] = [];
  private connections = new Set<Connection>();
  private changeListeners = new Set<() => void>();

  constructor(options: SlopServerOptions<S>) {
    super(options);
    this.id = options.id;
    this.name = options.name;
  }

  /**
   * Register a node with a static descriptor or a descriptor function.
   * Functions are re-evaluated on refresh() and after invoke().
   */
  register(path: string, descriptorOrFn: DescriptorFn | NodeDescriptor): void {
    if (typeof descriptorOrFn === "function") {
      this.dynamicRegistrations.set(path, descriptorOrFn);
      this.staticRegistrations.delete(path);
    } else {
      this.staticRegistrations.set(path, descriptorOrFn);
      this.dynamicRegistrations.delete(path);
    }
    this.rebuild();
  }

  /** Remove a registration. */
  unregister(path: string): void {
    this.dynamicRegistrations.delete(path);
    this.staticRegistrations.delete(path);
    this.rebuild();
  }

  /** Create a scoped server that prefixes all paths. */
  scope(prefix: string): SlopServer<unknown> {
    const parent = this;
    return {
      ...parent,
      register(path: string, descriptorOrFn: DescriptorFn | NodeDescriptor) {
        parent.register(`${prefix}/${path}`, descriptorOrFn);
      },
      unregister(path: string) {
        parent.unregister(`${prefix}/${path}`);
      },
      scope(subPrefix: string) {
        return parent.scope(`${prefix}/${subPrefix}`);
      },
      refresh() { parent.refresh(); },
    } as unknown as SlopServer<unknown>;
  }

  /**
   * Re-evaluate all descriptor functions, diff, and broadcast patches.
   * Call this after mutations that happen outside of SLOP (REST API, etc.).
   */
  refresh(): void {
    this.rebuild();
  }

  // --- Connection management (used by transport adapters) ---

  /** Handle a new consumer connection. */
  handleConnection(conn: Connection): void {
    this.connections.add(conn);
    conn.send(this.helloMessage());
  }

  /** Handle a message from a consumer. */
  async handleMessage(conn: Connection, msg: any): Promise<void> {
    switch (msg.type) {
      case "subscribe": {
        const outputTree = this.getOutputTree({
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter,
        });
        const sub: Subscription = {
          id: msg.id,
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter,
          connection: conn,
          lastTree: structuredClone(outputTree),
        };
        this.subscriptions.push(sub);
        conn.send({
          type: "snapshot",
          id: msg.id,
          version: this.getVersion(),
          tree: outputTree,
        });
        break;
      }

      case "unsubscribe": {
        const idx = this.subscriptions.findIndex(
          (s) => s.id === msg.id && s.connection === conn
        );
        if (idx >= 0) this.subscriptions.splice(idx, 1);
        break;
      }

      case "query": {
        conn.send(this.snapshotMessage(msg.id, {
          path: msg.path,
          depth: msg.depth,
          filter: msg.filter,
        }));
        break;
      }

      case "invoke": {
        const result = await this.executeInvoke(msg);
        conn.send(result);
        break;
      }
    }
  }

  /** Handle a consumer disconnect. */
  handleDisconnect(conn: Connection): void {
    this.connections.delete(conn);
    this.subscriptions = this.subscriptions.filter((s) => s.connection !== conn);
  }

  /** Register a listener that fires after every tree rebuild. */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => { this.changeListeners.delete(fn); };
  }

  /** Graceful shutdown. */
  stop(): void {
    for (const conn of this.connections) {
      try { conn.close(); } catch {}
    }
    this.connections.clear();
    this.subscriptions = [];
  }

  // --- ProviderBase hooks ---

  protected getRegistrations(): Map<string, NodeDescriptor> {
    const all = new Map<string, NodeDescriptor>();

    for (const [path, fn] of this.dynamicRegistrations) {
      try {
        all.set(path, fn());
      } catch (e) {
        console.error(`[slop] Error evaluating descriptor at "${path}":`, e);
      }
    }

    for (const [path, desc] of this.staticRegistrations) {
      all.set(path, desc);
    }

    return all;
  }

  protected broadcast(_globalOps: PatchOp[]): void {
    const version = this.getVersion();
    for (const sub of this.subscriptions) {
      try {
        const newTree = this.getOutputTree({
          path: sub.path,
          depth: sub.depth,
          filter: sub.filter,
        });

        if (!sub.lastTree) {
          // No previous tree — send snapshot
          sub.lastTree = structuredClone(newTree);
          sub.connection.send({
            type: "snapshot",
            id: sub.id,
            version,
            tree: newTree,
          });
          continue;
        }

        const ops = diffNodes(sub.lastTree, newTree);
        sub.lastTree = structuredClone(newTree);

        if (ops.length > 0) {
          sub.connection.send({
            type: "patch",
            subscription: sub.id,
            version,
            ops,
          });
        }
      } catch {
        // Connection may have been closed
      }
    }
    for (const fn of this.changeListeners) fn();
  }
}
