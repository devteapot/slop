import type {
  SlopNode, PatchOp, ActionHandler,
  NodeDescriptor, SlopClient, SlopClientOptions,
} from "./types";
import { assembleTree } from "./tree-assembler";
import { diffNodes } from "./diff";
import { createPostMessageTransport, type Transport } from "./transport";

interface Subscription {
  id: string;
  path: string;
  depth: number;
}

export class SlopClientImpl<S = unknown> implements SlopClient<S> {
  private options: SlopClientOptions<S>;
  private registrations = new Map<string, NodeDescriptor>();
  private currentTree: SlopNode = { id: "root", type: "root" };
  private currentHandlers = new Map<string, ActionHandler>();
  private version = 0;
  private transport: Transport;
  private subscriptions = new Map<string, Subscription>();
  private rebuildQueued = false;

  constructor(options: SlopClientOptions<S>) {
    this.options = options;
    this.transport = createPostMessageTransport();
  }

  register(path: string, descriptor: NodeDescriptor): void {
    this.registrations.set(path, descriptor);
    this.scheduleRebuild();
  }

  unregister(path: string, opts?: { recursive?: boolean }): void {
    if (opts?.recursive) {
      const prefix = path + "/";
      for (const key of [...this.registrations.keys()]) {
        if (key === path || key.startsWith(prefix)) {
          this.registrations.delete(key);
        }
      }
    } else {
      this.registrations.delete(path);
    }
    this.scheduleRebuild();
  }

  scope(path: string, descriptor?: NodeDescriptor): SlopClient<unknown> {
    if (descriptor) {
      this.register(path, descriptor);
    }
    return createScopedClient(this, path);
  }

  flush(): void {
    if (this.rebuildQueued) {
      this.rebuildQueued = false;
      this.rebuild();
    }
  }

  start(): void {
    this.transport.start();
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  stop(): void {
    this.transport.stop();
  }

  // --- Internal ---

  private scheduleRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    queueMicrotask(() => {
      if (!this.rebuildQueued) return; // flush() already ran
      this.rebuildQueued = false;
      this.rebuild();
    });
  }

  private rebuild(): void {
    const { tree, handlers } = assembleTree(
      this.registrations,
      this.options.id,
      this.options.name
    );
    const ops = diffNodes(this.currentTree, tree);
    this.currentHandlers = handlers;

    if (ops.length > 0) {
      this.currentTree = tree;
      this.version++;
      this.broadcastUpdate(ops);
    }
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "connect":
        this.transport.send({
          type: "hello",
          provider: {
            id: this.options.id,
            name: this.options.name,
            slop_version: "0.1",
            capabilities: ["state", "patches", "affordances"],
          },
        });
        break;

      case "subscribe":
        this.subscriptions.set(msg.id, {
          id: msg.id,
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
        });
        this.transport.send({
          type: "snapshot",
          id: msg.id,
          version: this.version,
          tree: this.currentTree,
        });
        break;

      case "unsubscribe":
        this.subscriptions.delete(msg.id);
        break;

      case "query":
        this.transport.send({
          type: "snapshot",
          id: msg.id,
          version: this.version,
          tree: this.currentTree,
        });
        break;

      case "invoke":
        this.handleInvoke(msg);
        break;
    }
  }

  private async handleInvoke(msg: { id: string; path: string; action: string; params?: Record<string, unknown> }): Promise<void> {
    const handler = this.resolveHandler(msg.path, msg.action);
    if (!handler) {
      this.transport.send({
        type: "result",
        id: msg.id,
        status: "error",
        error: { code: "not_found", message: `No handler for ${msg.action} at ${msg.path}` },
      });
      return;
    }

    try {
      const data = await handler(msg.params ?? {});
      this.transport.send({
        type: "result",
        id: msg.id,
        status: "ok",
        data: data ?? undefined,
      });
    } catch (err: any) {
      this.transport.send({
        type: "result",
        id: msg.id,
        status: "error",
        error: { code: err.code ?? "internal", message: err.message ?? String(err) },
      });
    }
  }

  private resolveHandler(path: string, action: string): ActionHandler | undefined {
    // Strip root prefix: "/app/inbox/messages/msg-1" → "inbox/messages/msg-1"
    const rootPrefix = `/${this.options.id}/`;
    let cleanPath = path;
    if (cleanPath.startsWith(rootPrefix)) {
      cleanPath = cleanPath.slice(rootPrefix.length);
    } else if (cleanPath.startsWith("/")) {
      cleanPath = cleanPath.slice(1);
    }

    // Try exact match first: "inbox/messages/msg-1/delete"
    const key = cleanPath ? `${cleanPath}/${action}` : action;
    const handler = this.currentHandlers.get(key);
    if (handler) return handler;

    // For items registered via `items` array, the path might include the item ID
    // Try walking up from the path
    return undefined;
  }

  private broadcastUpdate(ops: PatchOp[]): void {
    for (const [, sub] of this.subscriptions) {
      // For simplicity, send full snapshot on any change
      // (proper patch filtering can be added later)
      this.transport.send({
        type: "snapshot",
        id: sub.id,
        version: this.version,
        tree: this.currentTree,
      });
    }
  }
}

function createScopedClient<S>(parent: SlopClientImpl<any>, prefix: string): SlopClient<S> {
  return {
    register(path: string, descriptor: NodeDescriptor) {
      parent.register(`${prefix}/${path}`, descriptor);
    },
    unregister(path: string, opts?: { recursive?: boolean }) {
      parent.unregister(`${prefix}/${path}`, opts);
    },
    scope(path: string, descriptor?: NodeDescriptor) {
      return parent.scope(`${prefix}/${path}`, descriptor);
    },
    flush() {
      parent.flush();
    },
    stop() {
      // Scoped clients don't own the transport
    },
  };
}
