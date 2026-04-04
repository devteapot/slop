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

    // Wait for the extension to activate the bridge relay in the content
    // script before sending the SLOP connect handshake. The relay-open
    // triggers bridge-active → content script adds window listener.
    await new Promise((r) => setTimeout(r, 200));

    // Send SLOP connect handshake through the relay to trigger the
    // provider's hello response (same as PostMessageClientTransport)
    this.bridge.send({
      type: "slop-relay",
      providerKey: this.providerKey,
      message: { type: "connect" },
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
