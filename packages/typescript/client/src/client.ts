import { ProviderBase, diffNodes, AsyncActionResult } from "@slop-ai/core";
import type {
  SlopNode, PatchOp, ActionHandler, Action, ParamDef,
  NodeDescriptor, SlopClient, SlopClientOptions, TaskHandle, InferParams,
  SubscriptionFilter, Transport,
} from "@slop-ai/core";

interface Subscription {
  id: string;
  path: string;
  depth: number;
  filter?: SubscriptionFilter;
  lastTree: SlopNode | null;
  transport: Transport; // which transport this subscription came from
}

/**
 * In-browser SLOP provider. Extends ProviderBase with:
 * - Multi-transport support (postMessage + WebSocket simultaneously)
 * - Microtask-batched rebuilds
 * - Async action task tracking
 */
export class SlopClientImpl<S = unknown> extends ProviderBase<S> implements SlopClient<S> {
  private registrations = new Map<string, NodeDescriptor>();
  private transports: Transport[];
  private subscriptions = new Map<string, Subscription>();
  private rebuildQueued = false;

  constructor(options: SlopClientOptions<S>, transport: Transport | Transport[]) {
    super(options);
    this.transports = Array.isArray(transport) ? transport : [transport];
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

  asyncAction<P extends Record<string, ParamDef>>(
    params: P,
    fn: (params: InferParams<P>, task: TaskHandle) => Promise<unknown>,
    options?: { label?: string; description?: string; cancelable?: boolean }
  ): Action {
    return {
      estimate: "async" as const,
      params,
      label: options?.label,
      description: options?.description,
      handler: (rawParams: Record<string, unknown>) => {
        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const abortController = new AbortController();

        const task: TaskHandle = {
          id: taskId,
          signal: abortController.signal,
          update: (progress: number, message: string) => {
            this.register(`tasks/${taskId}`, {
              type: "status",
              props: { progress, message, status: "running", action: options?.label ?? "task" },
              meta: { salience: 0.8 },
              ...(options?.cancelable && {
                actions: {
                  cancel: {
                    dangerous: true,
                    handler: () => {
                      abortController.abort();
                      this.register(`tasks/${taskId}`, {
                        type: "status",
                        props: { status: "cancelled", message: "Cancelled" },
                        meta: { salience: 0.3 },
                      });
                      setTimeout(() => this.unregister(`tasks/${taskId}`), 10000);
                    },
                  },
                },
              }),
            });
          },
        };

        task.update(0, options?.label ? `${options.label}...` : "Starting...");

        fn(rawParams as InferParams<P>, task)
          .then((result) => {
            this.register(`tasks/${taskId}`, {
              type: "status",
              props: { progress: 1, message: "Complete", status: "done", result },
              meta: { salience: 0.5 },
            });
            setTimeout(() => this.unregister(`tasks/${taskId}`), 30000);
          })
          .catch((err: any) => {
            this.register(`tasks/${taskId}`, {
              type: "status",
              props: { progress: 0, message: err.message ?? String(err), status: "failed" },
              meta: { salience: 1.0, urgency: "high" },
            });
          });

        return new AsyncActionResult(taskId);
      },
    };
  }

  start(): void {
    for (const t of this.transports) {
      t.start();
      t.onMessage((msg) => this.handleMessage(msg, t));
    }
  }

  stop(): void {
    for (const t of this.transports) t.stop();
  }

  // --- ProviderBase hooks ---

  protected getRegistrations(): Map<string, NodeDescriptor> {
    return this.registrations;
  }

  protected broadcast(_globalOps: PatchOp[]): void {
    const version = this.getVersion();
    for (const [, sub] of this.subscriptions) {
      const newTree = this.getOutputTree({
        path: sub.path,
        depth: sub.depth,
        filter: sub.filter,
      });

      if (!sub.lastTree) {
        sub.lastTree = structuredClone(newTree);
        sub.transport.send({
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
        sub.transport.send({
          type: "patch",
          subscription: sub.id,
          version,
          ops,
        });
      }
    }
  }

  // --- Internal ---

  private scheduleRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    queueMicrotask(() => {
      if (!this.rebuildQueued) return;
      this.rebuildQueued = false;
      this.rebuild();
    });
  }

  private handleMessage(msg: any, transport: Transport): void {
    switch (msg.type) {
      case "connect":
        transport.send(this.helloMessage());
        break;

      case "subscribe": {
        const outputTree = this.getOutputTree({
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter,
        });
        this.subscriptions.set(msg.id, {
          id: msg.id,
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter,
          lastTree: structuredClone(outputTree),
          transport,
        });
        transport.send({
          type: "snapshot",
          id: msg.id,
          version: this.getVersion(),
          tree: outputTree,
        });
        break;
      }

      case "unsubscribe":
        this.subscriptions.delete(msg.id);
        break;

      case "query":
        transport.send(
          this.snapshotMessage(msg.id, { path: msg.path, depth: msg.depth, filter: msg.filter })
        );
        break;

      case "invoke":
        this.handleInvoke(msg, transport);
        break;
    }
  }

  private async handleInvoke(msg: { id: string; path: string; action: string; params?: Record<string, unknown> }, transport: Transport): Promise<void> {
    const result = await this.executeInvoke(msg);
    transport.send(result);
  }
}

function createScopedClient<S>(parent: SlopClientImpl<unknown>, prefix: string): SlopClient<S> {
  const base: SlopClient<S> = parent;

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "register") {
        return (path: string, descriptor: NodeDescriptor) => {
          parent.register(`${prefix}/${path}`, descriptor);
        };
      }
      if (prop === "unregister") {
        return (path: string, opts?: { recursive?: boolean }) => {
          parent.unregister(`${prefix}/${path}`, opts);
        };
      }
      if (prop === "scope") {
        return (path: string, descriptor?: NodeDescriptor) =>
          parent.scope(`${prefix}/${path}`, descriptor);
      }
      if (prop === "flush") {
        return () => parent.flush();
      }
      if (prop === "asyncAction") {
        return parent.asyncAction.bind(parent);
      }
      if (prop === "stop") {
        return () => {};
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(parent) : value;
    },
  });
}
