import { assembleTree, diffNodes } from "@slop-ai/core";
import type {
  SlopNode, PatchOp, ActionHandler, NodeDescriptor,
  SlopClientOptions,
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
  connection: Connection;
}

export interface SlopServerOptions<S = unknown> extends SlopClientOptions<S> {}

export class SlopServer<S = unknown> {
  readonly id: string;
  readonly name: string;

  private options: SlopServerOptions<S>;
  private registrations = new Map<string, DescriptorFn>();
  private staticRegistrations = new Map<string, NodeDescriptor>();
  private currentTree: SlopNode = { id: "root", type: "root" };
  private currentHandlers = new Map<string, ActionHandler>();
  private version = 0;
  private subscriptions: Subscription[] = [];
  private connections = new Set<Connection>();
  private changeListeners = new Set<() => void>();

  constructor(options: SlopServerOptions<S>) {
    this.options = options;
    this.id = options.id;
    this.name = options.name;
  }

  /**
   * Register a node with a descriptor function.
   * The function is re-evaluated on refresh() and after invoke().
   */
  register(path: string, descriptorOrFn: DescriptorFn | NodeDescriptor): void {
    if (typeof descriptorOrFn === "function") {
      this.registrations.set(path, descriptorOrFn);
      this.staticRegistrations.delete(path);
    } else {
      this.staticRegistrations.set(path, descriptorOrFn);
      this.registrations.delete(path);
    }
    this.rebuild();
  }

  /** Remove a registration. */
  unregister(path: string): void {
    this.registrations.delete(path);
    this.staticRegistrations.delete(path);
    this.rebuild();
  }

  /** Create a scoped server that prefixes all paths. */
  scope(prefix: string): SlopServer<unknown> {
    const parent = this;
    // Return a proxy-like object that delegates to parent with prefixed paths
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

  /** Get the current tree (for inspection/testing). */
  getTree(): SlopNode {
    return this.currentTree;
  }

  /** Get the current version. */
  getVersion(): number {
    return this.version;
  }

  // --- Connection management (used by transport adapters) ---

  /** Handle a new consumer connection. */
  handleConnection(conn: Connection): void {
    this.connections.add(conn);

    // Send hello
    conn.send({
      type: "hello",
      provider: {
        id: this.id,
        name: this.name,
        slop_version: "0.1",
        capabilities: ["state", "patches", "affordances"],
      },
    });
  }

  /** Handle a message from a consumer. */
  async handleMessage(conn: Connection, msg: any): Promise<void> {
    switch (msg.type) {
      case "subscribe": {
        this.subscriptions.push({
          id: msg.id,
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          connection: conn,
        });
        conn.send({
          type: "snapshot",
          id: msg.id,
          version: this.version,
          tree: this.currentTree,
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
        conn.send({
          type: "snapshot",
          id: msg.id,
          version: this.version,
          tree: this.currentTree,
        });
        break;
      }

      case "invoke": {
        await this.handleInvoke(conn, msg);
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

  // --- Internal ---

  private rebuild(): void {
    // Evaluate all descriptor functions
    const allDescriptors = new Map<string, NodeDescriptor>();

    for (const [path, fn] of this.registrations) {
      try {
        allDescriptors.set(path, fn());
      } catch (e) {
        console.error(`[slop] Error evaluating descriptor at "${path}":`, e);
      }
    }

    for (const [path, desc] of this.staticRegistrations) {
      allDescriptors.set(path, desc);
    }

    const { tree, handlers } = assembleTree(allDescriptors, this.id, this.name);
    const ops = diffNodes(this.currentTree, tree);
    this.currentHandlers = handlers;

    if (ops.length > 0) {
      this.currentTree = tree;
      this.version++;
      this.broadcastPatches(ops);
      for (const fn of this.changeListeners) fn();
    } else if (this.version === 0) {
      // First build — store tree even if no diff (there's nothing to diff against)
      this.currentTree = tree;
      this.version = 1;
    }
  }

  private async handleInvoke(
    conn: Connection,
    msg: { id: string; path: string; action: string; params?: Record<string, unknown> }
  ): Promise<void> {
    const handler = this.resolveHandler(msg.path, msg.action);
    if (!handler) {
      conn.send({
        type: "result",
        id: msg.id,
        status: "error",
        error: {
          code: "not_found",
          message: `No handler for ${msg.action} at ${msg.path}`,
        },
      });
      return;
    }

    try {
      const data = await handler(msg.params ?? {});
      conn.send({
        type: "result",
        id: msg.id,
        status: "ok",
        ...(data != null && { data }),
      });

      // Auto-refresh after invoke — re-evaluate descriptors and broadcast changes
      this.rebuild();
    } catch (err: any) {
      conn.send({
        type: "result",
        id: msg.id,
        status: "error",
        error: {
          code: err.code ?? "internal",
          message: err.message ?? String(err),
        },
      });
    }
  }

  private resolveHandler(path: string, action: string): ActionHandler | undefined {
    // Strip root prefix
    const rootPrefix = `/${this.id}/`;
    let cleanPath = path;
    if (cleanPath.startsWith(rootPrefix)) {
      cleanPath = cleanPath.slice(rootPrefix.length);
    } else if (cleanPath.startsWith("/")) {
      cleanPath = cleanPath.slice(1);
    }

    const key = cleanPath ? `${cleanPath}/${action}` : action;
    return this.currentHandlers.get(key);
  }

  private broadcastPatches(ops: PatchOp[]): void {
    for (const sub of this.subscriptions) {
      try {
        // Send full snapshot (simpler and more reliable than filtered patches)
        sub.connection.send({
          type: "snapshot",
          id: sub.id,
          version: this.version,
          tree: this.currentTree,
        });
      } catch {
        // Connection may have been closed
      }
    }
  }
}
