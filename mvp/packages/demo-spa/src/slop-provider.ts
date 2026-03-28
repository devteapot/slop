/**
 * Browser-side SLOP provider using postMessage transport.
 * Runs inside the SPA page. The extension connects via postMessage.
 */

export interface SlopNode {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  children?: SlopNode[];
  affordances?: { action: string; label?: string; description?: string; params?: any; dangerous?: boolean }[];
  meta?: Record<string, unknown>;
}

interface PatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

interface Subscription {
  id: string;
  path: string;
  depth: number;
}

type InvokeHandler = (params: Record<string, unknown>, path: string) => unknown | Promise<unknown>;

export class BrowserSlopProvider {
  private tree: SlopNode = { id: "root", type: "root" };
  private version = 0;
  private subscriptions = new Map<string, Subscription>();
  private handlers = new Map<string, InvokeHandler>();
  private config: { id: string; name: string };
  private listening = false;

  constructor(config: { id: string; name: string }) {
    this.config = config;
  }

  /** Start listening for postMessage connections from extensions */
  start(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("message", this.onMessage);
  }

  stop(): void {
    this.listening = false;
    window.removeEventListener("message", this.onMessage);
  }

  /** Set the full state tree. Broadcasts snapshot to all subscribers. */
  setTree(root: SlopNode): void {
    this.tree = root;
    this.version++;
    // Send snapshot to all subscribers (simple approach — no diffing in browser)
    for (const [, sub] of this.subscriptions) {
      this.sendSlop({
        type: "snapshot",
        id: sub.id,
        version: this.version,
        tree: this.tree,
      });
    }
  }

  /** Register an affordance handler */
  onInvoke(action: string, handler: InvokeHandler): void {
    this.handlers.set(action, handler);
  }

  private onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data?.slop !== true) return;

    const msg = event.data.message;
    if (!msg?.type) return;

    this.handleMessage(msg);
  };

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "connect":
        // Send hello
        this.sendSlop({
          type: "hello",
          provider: {
            id: this.config.id,
            name: this.config.name,
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
        this.sendSlop({
          type: "snapshot",
          id: msg.id,
          version: this.version,
          tree: this.tree,
        });
        break;

      case "unsubscribe":
        this.subscriptions.delete(msg.id);
        break;

      case "query":
        this.sendSlop({
          type: "snapshot",
          id: msg.id,
          version: this.version,
          tree: this.tree,
        });
        break;

      case "invoke":
        this.handleInvoke(msg);
        break;
    }
  }

  private async handleInvoke(msg: any): Promise<void> {
    const handler = this.handlers.get(msg.action);
    if (!handler) {
      this.sendSlop({
        type: "result",
        id: msg.id,
        status: "error",
        error: { code: "not_found", message: `No handler for action: ${msg.action}` },
      });
      return;
    }

    try {
      const data = await handler(msg.params ?? {}, msg.path);
      this.sendSlop({
        type: "result",
        id: msg.id,
        status: "ok",
        data: data ?? undefined,
      });
    } catch (err: any) {
      this.sendSlop({
        type: "result",
        id: msg.id,
        status: "error",
        error: { code: err.code ?? "internal", message: err.message ?? String(err) },
      });
    }
  }

  private sendSlop(message: any): void {
    window.postMessage({ slop: true, message }, "*");
  }
}
