import { Emitter } from "./emitter";
import { StateMirror, SubscriptionGapError } from "./state-mirror";
import type {
  BatchMessage,
  ClientTransport,
  Connection,
  ErrorMessage,
  EventMessage,
  HelloMessage,
  PatchOp,
  ProviderMessage,
  ResultMessage,
  SlopMessage,
  SlopNode,
} from "./types";

interface SubscriptionRecord {
  path: string;
  depth: number;
  options?: { max_nodes?: number; filter?: { types?: string[]; min_salience?: number } };
}

export class SlopConsumer extends Emitter {
  private connection: Connection | null = null;
  private mirrors = new Map<string, StateMirror>();
  private subscriptions = new Map<string, SubscriptionRecord>();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private transport: ClientTransport;
  private subCounter = 0;
  private reqCounter = 0;
  private errorCallbacks = new Set<(error: ErrorMessage["error"], id?: string) => void>();
  private eventCallbacks = new Set<(name: string, data: unknown) => void>();

  constructor(transport: ClientTransport) {
    super();
    this.transport = transport;
  }

  async connect(): Promise<HelloMessage> {
    this.connection = await this.transport.connect();
    return new Promise((resolve) => {
      this.connection!.onMessage((msg: SlopMessage) => {
        const m = msg as ProviderMessage;
        if (m.type === "hello") {
          resolve(m);
          this.connection!.onMessage((msg2: SlopMessage) => this.handleMessage(msg2 as ProviderMessage));
        }
      });
      this.connection!.onClose(() => this.emit("disconnect"));
    });
  }

  async subscribe(
    path = "/",
    depth = 1,
    options?: { max_nodes?: number; filter?: { types?: string[]; min_salience?: number } },
  ): Promise<{ id: string; snapshot: SlopNode }> {
    const id = `sub-${++this.subCounter}`;
    this.subscriptions.set(id, { path, depth, options });
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (snapshot: SlopNode) => resolve({ id, snapshot }),
        reject,
      });
      this.sendSubscribe(id);
    });
  }

  unsubscribe(id: string): void {
    this.mirrors.delete(id);
    this.subscriptions.delete(id);
    this.connection?.send({ type: "unsubscribe", id });
  }

  private sendSubscribe(id: string): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;
    this.connection?.send({
      type: "subscribe",
      id,
      path: sub.path,
      depth: sub.depth,
      ...(sub.options?.max_nodes != null && { max_nodes: sub.options.max_nodes }),
      ...(sub.options?.filter && { filter: sub.options.filter }),
    });
  }

  async query(
    path = "/",
    depth = 1,
    options?: { max_nodes?: number; filter?: { types?: string[]; min_salience?: number }; window?: [number, number] },
  ): Promise<SlopNode> {
    const id = `q-${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.connection!.send({
        type: "query",
        id,
        path,
        depth,
        ...(options?.max_nodes != null && { max_nodes: options.max_nodes }),
        ...(options?.filter && { filter: options.filter }),
        ...(options?.window && { window: options.window }),
      });
    });
  }

  async invoke(path: string, action: string, params?: Record<string, unknown>): Promise<ResultMessage> {
    const id = `inv-${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.connection!.send({ type: "invoke", id, path, action, params });
    });
  }

  getTree(subscriptionId: string): SlopNode | null {
    return this.mirrors.get(subscriptionId)?.getTree() ?? null;
  }

  onError(fn: (error: ErrorMessage["error"], id?: string) => void): () => void {
    this.errorCallbacks.add(fn);
    return () => {
      this.errorCallbacks.delete(fn);
    };
  }

  onEvent(fn: (name: string, data: unknown) => void): () => void {
    this.eventCallbacks.add(fn);
    return () => {
      this.eventCallbacks.delete(fn);
    };
  }

  disconnect(): void {
    this.connection?.close();
    this.connection = null;
  }

  private handleMessage(msg: ProviderMessage): void {
    switch (msg.type) {
      case "snapshot": {
        const existed = this.mirrors.has(msg.id);
        const mirror = new StateMirror(msg);
        this.mirrors.set(msg.id, mirror);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg.tree);
        } else if (existed) {
          // Re-snapshot for an existing subscription — emit as a state change
          this.emit("patch", msg.id, [], msg.version);
        }
        break;
      }
      case "patch": {
        const mirror = this.mirrors.get(msg.subscription);
        if (!mirror) break;
        try {
          mirror.applyPatch(msg);
          this.emit("patch", msg.subscription, msg.ops, msg.version);
        } catch (err) {
          if (err instanceof SubscriptionGapError) {
            // Gap detected — drop the mirror and resubscribe to close the gap
            // by construction. Per spec/core/messages.md, consumer MUST send
            // unsubscribe followed by a fresh subscribe; buffered patches
            // for this subscription are discarded when the new snapshot
            // arrives (version ≤ snapshot.version).
            this.mirrors.delete(msg.subscription);
            this.connection?.send({ type: "unsubscribe", id: msg.subscription });
            this.emit("gap", msg.subscription, err.expected, err.received);
            this.sendSubscribe(msg.subscription);
          } else {
            throw err;
          }
        }
        break;
      }
      case "result": {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
        break;
      }
      case "error": {
        const errMsg = msg as ErrorMessage;
        if (errMsg.id) {
          const p = this.pending.get(errMsg.id);
          if (p) {
            this.pending.delete(errMsg.id);
            p.reject(errMsg.error);
          }
        }
        for (const fn of this.errorCallbacks) fn(errMsg.error, errMsg.id);
        break;
      }
      case "event": {
        const evtMsg = msg as EventMessage;
        for (const fn of this.eventCallbacks) fn(evtMsg.name, evtMsg.data);
        break;
      }
      case "batch": {
        const batchMsg = msg as BatchMessage;
        for (const inner of batchMsg.messages) {
          this.handleMessage(inner);
        }
        break;
      }
    }
  }
}
