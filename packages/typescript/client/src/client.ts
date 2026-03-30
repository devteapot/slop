import { ProviderBase } from "@slop-ai/core";
import type {
  SlopNode, ActionHandler, Action, ParamDef,
  NodeDescriptor, SlopClient, SlopClientOptions, TaskHandle, InferParams,
  SubscriptionFilter, Transport,
} from "@slop-ai/core";

interface Subscription {
  id: string;
  path: string;
  depth: number;
  filter?: SubscriptionFilter;
}

/**
 * In-browser SLOP provider. Extends ProviderBase with:
 * - Single transport (postMessage)
 * - Microtask-batched rebuilds
 * - Async action task tracking
 */
export class SlopClientImpl<S = unknown> extends ProviderBase<S> implements SlopClient<S> {
  private registrations = new Map<string, NodeDescriptor>();
  private transport: Transport;
  private subscriptions = new Map<string, Subscription>();
  private rebuildQueued = false;

  constructor(options: SlopClientOptions<S>, transport: Transport) {
    super(options);
    this.transport = transport;
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

        return { __async: true, taskId };
      },
    };
  }

  start(): void {
    this.transport.start();
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  stop(): void {
    this.transport.stop();
  }

  // --- ProviderBase hooks ---

  protected getRegistrations(): Map<string, NodeDescriptor> {
    return this.registrations;
  }

  protected broadcast(): void {
    for (const [, sub] of this.subscriptions) {
      this.transport.send({
        type: "snapshot",
        subscription: sub.id,
        version: this.version,
        tree: this.getOutputTree({ path: sub.path, depth: sub.depth, filter: sub.filter }),
      });
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

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "connect":
        this.transport.send(this.helloMessage());
        break;

      case "subscribe":
        this.subscriptions.set(msg.id, {
          id: msg.id,
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter,
        });
        this.transport.send(
          this.snapshotMessage(msg.id, { path: msg.path, depth: msg.depth, filter: msg.filter })
        );
        break;

      case "unsubscribe":
        this.subscriptions.delete(msg.id);
        break;

      case "query":
        this.transport.send(
          this.snapshotMessage(msg.id, { path: msg.path, depth: msg.depth, filter: msg.filter })
        );
        break;

      case "invoke":
        this.handleInvoke(msg);
        break;
    }
  }

  private async handleInvoke(msg: { id: string; path: string; action: string; params?: Record<string, unknown> }): Promise<void> {
    const result = await this.executeInvoke(msg);
    this.transport.send(result);
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
    asyncAction: parent.asyncAction.bind(parent) as any,
    stop() {},
  };
}
