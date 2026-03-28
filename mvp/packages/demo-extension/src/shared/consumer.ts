import type {
  ClientTransport, Connection, HelloMessage, SlopNode,
  ResultMessage, PatchOp, SlopMessage, ProviderMessage,
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
    return new Promise((resolve) => {
      this.pending.set(id, {
        resolve: (snapshot: SlopNode) => resolve({ id, snapshot }),
        reject: () => {},
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

  disconnect(): void {
    this.connection?.close();
    this.connection = null;
  }

  private handleMessage(msg: ProviderMessage): void {
    switch (msg.type) {
      case "snapshot": {
        const mirror = new StateMirror(msg);
        this.mirrors.set(msg.id, mirror);
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p.resolve(msg.tree); }
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
    }
  }
}
