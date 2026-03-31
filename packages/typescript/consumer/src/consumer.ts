import type {
  ClientTransport, Connection, HelloMessage, SlopNode,
  ResultMessage, PatchOp, SlopMessage, ProviderMessage,
  ErrorMessage, EventMessage, BatchMessage,
} from "./types";
import { StateMirror } from "./state-mirror";
import { Emitter } from "./emitter";

export class SlopConsumer extends Emitter {
  private connection: Connection | null = null;
  private mirrors = new Map<string, StateMirror>();
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
          this.connection!.onMessage((msg2: SlopMessage) =>
            this.handleMessage(msg2 as ProviderMessage)
          );
        }
      });
      this.connection!.onClose(() => this.emit("disconnect"));
    });
  }

  async subscribe(path = "/", depth = 1): Promise<{ id: string; snapshot: SlopNode }> {
    const id = `sub-${++this.subCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (snapshot: SlopNode) => resolve({ id, snapshot }),
        reject,
      });
      this.connection!.send({ type: "subscribe", id, path, depth });
    });
  }

  unsubscribe(id: string): void {
    this.mirrors.delete(id);
    this.connection?.send({ type: "unsubscribe", id });
  }

  async query(path = "/", depth = 1): Promise<SlopNode> {
    const id = `q-${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.connection!.send({ type: "query", id, path, depth });
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
    return () => { this.errorCallbacks.delete(fn); };
  }

  onEvent(fn: (name: string, data: unknown) => void): () => void {
    this.eventCallbacks.add(fn);
    return () => { this.eventCallbacks.delete(fn); };
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
        if (mirror) {
          mirror.applyPatch(msg);
          this.emit("patch", msg.subscription, msg.ops, msg.version);
        }
        break;
      }
      case "result": {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p.resolve(msg); }
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
