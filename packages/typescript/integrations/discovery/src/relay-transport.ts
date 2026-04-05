import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "@slop-ai/consumer";
import type { Bridge, RelayHandler } from "./bridge-client";

/**
 * ClientTransport that routes SLOP messages through the extension bridge
 * for postMessage-based browser tab providers.
 */
export class BridgeRelayTransport implements ClientTransport {
  constructor(
    private bridge: Bridge,
    private providerKey: string,
  ) {}

  async connect(): Promise<Connection> {
    const messageHandlers: MessageHandler[] = [];
    let closeHandlers: (() => void)[] = [];
    let closed = false;

    // Subscribe to relay messages for this provider
    const subs = this.bridge.subscribeRelay(this.providerKey);
    const relayHandler: RelayHandler = (message) => {
      for (const h of messageHandlers) {
        h(message as unknown as SlopMessage);
      }
    };
    subs.push(relayHandler);

    // Tell the extension to start relaying for this provider
    this.bridge.send({
      type: "relay-open",
      providerKey: this.providerKey,
    });

    // Send SLOP connect handshake with retry. The relay-open triggers
    // bridge-active → content script adds window listener, which may not
    // be ready immediately. Instead of a fixed delay we send the connect
    // handshake and retry up to 3 times until the relay responds.
    const RETRY_DELAY = 300;
    const MAX_RETRIES = 3;
    let gotResponse = false;
    const sentinel = () => { gotResponse = true; };
    messageHandlers.push(sentinel);

    for (let attempt = 0; attempt <= MAX_RETRIES && !gotResponse; attempt++) {
      this.bridge.send({
        type: "slop-relay",
        providerKey: this.providerKey,
        message: { type: "connect" },
      });
      if (!gotResponse) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }
    }

    // Remove sentinel — normal message flow takes over
    const idx = messageHandlers.indexOf(sentinel);
    if (idx >= 0) messageHandlers.splice(idx, 1);

    return {
      send: (msg: SlopMessage) => {
        if (closed) return;
        this.bridge.send({
          type: "slop-relay",
          providerKey: this.providerKey,
          message: msg,
        });
      },

      onMessage: (handler: MessageHandler) => {
        messageHandlers.push(handler);
      },

      onClose: (handler: () => void) => {
        closeHandlers.push(handler);
      },

      close: () => {
        if (closed) return;
        closed = true;

        // Tell extension to stop relaying
        this.bridge.send({
          type: "relay-close",
          providerKey: this.providerKey,
        });

        this.bridge.unsubscribeRelay(this.providerKey, relayHandler);

        for (const h of closeHandlers) h();
        closeHandlers = [];
      },
    };
  }
}
