import type {
  SlopNode,
  Capability,
  ServerTransport,
  Connection,
  ConsumerMessage,
  SlopMessage,
  PatchOp,
} from "@slop/types";
import { StateTree } from "./state-tree";
import { SubscriptionManager } from "./subscription";
import { registerProvider, unregisterProvider } from "./discovery";

type AffordanceHandler = (
  params: Record<string, unknown>,
  path: string
) => Promise<unknown> | unknown;

export interface ProviderConfig {
  id: string;
  name: string;
  capabilities?: Capability[];
  transport: ServerTransport;
  register?: boolean;
}

export class SlopProvider {
  private stateTree: StateTree;
  private subscriptions = new SubscriptionManager();
  private affordanceHandlers = new Map<string, AffordanceHandler>();
  private config: ProviderConfig;
  private connections = new Set<Connection>();

  constructor(config: ProviderConfig) {
    this.config = config;
    this.stateTree = new StateTree({ id: "root", type: "root" });
  }

  /** Set the full state tree. Computes diff and pushes patches to subscribers. */
  setTree(root: SlopNode): void {
    const ops = this.stateTree.setTree(root);
    if (ops.length > 0) {
      this.broadcastPatches(ops);
    }
  }

  /** Register an affordance handler */
  onInvoke(action: string, handler: AffordanceHandler): void {
    this.affordanceHandlers.set(action, handler);
  }

  /** Start listening for connections */
  async start(): Promise<void> {
    await this.config.transport.listen((conn) => this.handleConnection(conn));

    if (this.config.register) {
      const transport = this.config.transport as any;
      registerProvider({
        id: this.config.id,
        name: this.config.name,
        slop_version: "0.1",
        transport: {
          type: "unix",
          path: transport.getSocketPath?.() ?? undefined,
        },
        pid: process.pid,
        capabilities: this.config.capabilities ?? ["state", "patches", "affordances"],
      });
    }
  }

  /** Stop the provider */
  async stop(): Promise<void> {
    if (this.config.register) {
      unregisterProvider(this.config.id);
    }
    for (const conn of this.connections) {
      conn.close();
    }
    this.connections.clear();
    await this.config.transport.close();
  }

  private handleConnection(conn: Connection): void {
    this.connections.add(conn);

    // Send hello
    conn.send({
      type: "hello",
      provider: {
        id: this.config.id,
        name: this.config.name,
        slop_version: "0.1",
        capabilities: this.config.capabilities ?? ["state", "patches", "affordances"],
      },
    });

    conn.onMessage((msg: SlopMessage) => {
      this.handleMessage(conn, msg as ConsumerMessage);
    });

    conn.onClose(() => {
      this.subscriptions.removeByConnection(conn);
      this.connections.delete(conn);
    });
  }

  private handleMessage(conn: Connection, msg: ConsumerMessage): void {
    switch (msg.type) {
      case "subscribe":
        this.handleSubscribe(conn, msg);
        break;
      case "unsubscribe":
        this.subscriptions.remove(msg.id);
        break;
      case "query":
        this.handleQuery(conn, msg);
        break;
      case "invoke":
        this.handleInvoke(conn, msg);
        break;
    }
  }

  private handleSubscribe(
    conn: Connection,
    msg: { id: string; path?: string; depth?: number }
  ): void {
    const path = msg.path ?? "/";
    const depth = msg.depth ?? 1;

    this.subscriptions.add({
      id: msg.id,
      path,
      depth,
      connection: conn,
      lastVersion: this.stateTree.getVersion(),
    });

    const tree = this.stateTree.resolveAtDepth(path, depth);
    conn.send({
      type: "snapshot",
      id: msg.id,
      version: this.stateTree.getVersion(),
      tree: tree as SlopNode,
    });
  }

  private handleQuery(
    conn: Connection,
    msg: { id: string; path?: string; depth?: number }
  ): void {
    const path = msg.path ?? "/";
    const depth = msg.depth ?? 1;
    const tree = this.stateTree.resolveAtDepth(path, depth);

    if (!tree) {
      conn.send({
        type: "result",
        id: msg.id,
        status: "error",
        error: { code: "not_found", message: `Path ${path} not found` },
      });
      return;
    }

    conn.send({
      type: "snapshot",
      id: msg.id,
      version: this.stateTree.getVersion(),
      tree: tree as SlopNode,
    });
  }

  private async handleInvoke(
    conn: Connection,
    msg: { id: string; path: string; action: string; params?: Record<string, unknown> }
  ): Promise<void> {
    const handler = this.affordanceHandlers.get(msg.action);
    if (!handler) {
      conn.send({
        type: "result",
        id: msg.id,
        status: "error",
        error: { code: "not_found", message: `No handler for action: ${msg.action}` },
      });
      return;
    }

    try {
      const data = await handler(msg.params ?? {}, msg.path);
      conn.send({
        type: "result",
        id: msg.id,
        status: "ok",
        data: data ?? undefined,
      });
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

  private broadcastPatches(ops: PatchOp[]): void {
    const version = this.stateTree.getVersion();
    for (const sub of this.subscriptions.getAll()) {
      const filtered = this.subscriptions.filterOps(sub, ops);
      if (filtered.length > 0) {
        sub.connection.send({
          type: "patch",
          subscription: sub.id,
          version,
          ops: filtered,
        });
        sub.lastVersion = version;
      }
    }
  }
}
