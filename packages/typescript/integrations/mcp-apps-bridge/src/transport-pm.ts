import type { ClientTransport, Connection, MessageHandler, SlopMessage } from "@slop-ai/consumer/browser";

/**
 * Consumer-side postMessage transport for same-window SLOP providers.
 *
 * Mirrors the provider-side envelope from `@slop-ai/client` —
 * `{ slop: true, message }` — so a provider instantiated with
 * `createSlop({ transport: createPostMessageTransport() })` inside the same
 * iframe as this bridge can be consumed without any network egress.
 *
 * Demultiplexing: only frames with `event.data?.slop === true` are claimed,
 * so MCP Apps JSON-RPC frames pass through untouched to the ext-apps
 * `App` listener running in the same window.
 */
export class SameWindowPostMessageTransport implements ClientTransport {
  private targetWindow: Window;
  private originFilter: string;

  constructor(options: { targetWindow?: Window; origin?: string } = {}) {
    this.targetWindow = options.targetWindow ?? window;
    // Spec: never "*". Default to this window's own origin, which is correct
    // for the common same-window MCP Apps case. Cross-origin hosts MUST pass
    // an explicit `origin`.
    this.originFilter = options.origin ?? window.location.origin;
  }

  async connect(): Promise<Connection> {
    const messageHandlers: MessageHandler[] = [];
    const closeHandlers: (() => void)[] = [];

    const listener = (event: MessageEvent) => {
      if (event.source !== this.targetWindow) return;
      if (event.origin !== this.originFilter) return;
      if (event.data?.slop !== true) return;
      const msg = event.data.message as SlopMessage | undefined;
      if (!msg || typeof (msg as { type?: unknown }).type !== "string") return;
      for (const h of messageHandlers) h(msg);
    };
    window.addEventListener("message", listener);

    // Handshake — identical to the Chrome-extension flow, but over window.postMessage.
    this.targetWindow.postMessage({ slop: true, message: { type: "connect" } }, this.originFilter);

    return {
      send: (m: SlopMessage) => {
        this.targetWindow.postMessage({ slop: true, message: m }, this.originFilter);
      },
      onMessage: (h: MessageHandler) => {
        messageHandlers.push(h);
      },
      onClose: (h: () => void) => {
        closeHandlers.push(h);
      },
      close: () => {
        window.removeEventListener("message", listener);
        for (const h of closeHandlers) h();
        messageHandlers.length = 0;
        closeHandlers.length = 0;
      },
    };
  }
}
