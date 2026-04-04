import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "@slop-ai/consumer";
import type { BridgeClient, RelayHandler } from "./bridge-client";

/**
 * ClientTransport that routes SLOP messages through the extension bridge
 * for postMessage-based browser tab providers.
 */
export class BridgeRelayTransport implements ClientTransport {
  constructor(
    private bridge: BridgeClient,
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
