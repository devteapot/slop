import type { NodeDescriptor, ActionHandler } from "@slop-ai/core";

/**
 * Client-side adapter that manages the bidirectional WebSocket connection
 * between the browser and the SLOP server.
 *
 * Responsibilities:
 * - Reports UI state to server via register/unregister messages
 * - Receives invoke_ui messages and executes local handlers
 * - Receives data_changed signals and triggers framework invalidation
 * - Handles version checking on connect (hydration race condition)
 * - Auto-reconnects on disconnect
 */
export class SlopUIAdapter {
  private ws: WebSocket | null = null;
  private registrations = new Map<string, NodeDescriptor>();
  private handlers = new Map<string, ActionHandler>();
  private onInvalidate: (() => void) | null = null;
  private url: string = "";
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {}

  /** Connect to the SLOP WebSocket and set up the bidirectional bridge. */
  connect(url: string, onInvalidate: () => void): void {
    this.url = url;
    this.onInvalidate = onInvalidate;

    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = url.startsWith("ws") ? url : `${protocol}//${window.location.host}${url}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;

      // Identify as browser client — server will send data_changed if anything is stale
      this.send({ type: "hydrate" });

      // Re-send all current registrations (in case of reconnect)
      for (const [path, descriptor] of this.registrations) {
        this.send({ type: "register", path, descriptor: this.stripHandlers(descriptor) });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      // Auto-reconnect if we still have registrations
      if (this.registrations.size > 0 || this.onInvalidate) {
        this.reconnectTimer = setTimeout(() => this.connect(url, onInvalidate), 2000);
      }
    };
  }

  /** Register UI state. Sends to server (sans handlers) and stores handlers locally. */
  register(path: string, descriptor: NodeDescriptor): void {
    this.registrations.set(path, descriptor);
    this.extractHandlers(path, descriptor);

    if (this.connected) {
      this.send({ type: "register", path, descriptor: this.stripHandlers(descriptor) });
    }
  }

  /** Unregister UI state. */
  unregister(path: string): void {
    this.registrations.delete(path);
    // Remove all handlers for this path
    for (const key of [...this.handlers.keys()]) {
      if (key.startsWith(path + "/") || key === path) {
        this.handlers.delete(key);
      }
    }

    if (this.connected) {
      this.send({ type: "unregister", path });
    }
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  // --- Internal ---

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "data_changed":
        this.onInvalidate?.();
        break;

      case "invoke_ui": {
        const cleanPath = msg.path.replace(/^\/?(ui\/)?/, "");
        const key = `${cleanPath}/${msg.action}`;
        const handler = this.handlers.get(key);
        if (handler) {
          try {
            handler(msg.params ?? {});
          } catch (err) {
            console.error("[slop] UI action handler error:", err);
          }
        }
        break;
      }

      // Ignore SLOP protocol messages (hello, snapshot, etc.) — those are for AI consumers
    }
  }

  private extractHandlers(path: string, descriptor: NodeDescriptor): void {
    // Extract action handlers from descriptor
    if (descriptor.actions) {
      for (const [name, action] of Object.entries(descriptor.actions)) {
        const handler = typeof action === "function" ? action : (action as any)?.handler;
        if (handler) {
          this.handlers.set(`${path}/${name}`, handler);
        }
      }
    }

    // Extract from items
    if (descriptor.items) {
      for (const item of descriptor.items) {
        if (item.actions) {
          for (const [name, action] of Object.entries(item.actions)) {
            const handler = typeof action === "function" ? action : (action as any)?.handler;
            if (handler) {
              this.handlers.set(`${path}/${item.id}/${name}`, handler);
            }
          }
        }
      }
    }
  }

  private stripHandlers(descriptor: NodeDescriptor): NodeDescriptor {
    const stripped: any = { ...descriptor };

    if (stripped.actions) {
      const actions: Record<string, any> = {};
      for (const [name, action] of Object.entries(stripped.actions)) {
        if (typeof action === "function") {
          actions[name] = {}; // bare handler → empty action descriptor
        } else {
          const { handler, ...rest } = action as any;
          actions[name] = rest;
        }
      }
      stripped.actions = actions;
    }

    if (stripped.items) {
      stripped.items = stripped.items.map((item: any) => {
        if (!item.actions) return item;
        const actions: Record<string, any> = {};
        for (const [name, action] of Object.entries(item.actions)) {
          if (typeof action === "function") {
            actions[name] = {};
          } else {
            const { handler, ...rest } = action as any;
            actions[name] = rest;
          }
        }
        return { ...item, actions };
      });
    }

    return stripped;
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
