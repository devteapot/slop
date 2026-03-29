import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "@slop-ai/consumer/browser";

/**
 * Bridge transport for SPA providers.
 * Routes SLOP messages through the desktop bridge server → extension → page postMessage.
 */
export class BridgeClientTransport implements ClientTransport {
  constructor(private tabId: number) {}

  async connect(): Promise<Connection> {
    const messageHandlers: MessageHandler[] = [];
    const closeHandlers: (() => void)[] = [];
    const tabId = this.tabId;

    // Listen for SLOP messages relayed back from the extension
    const unlisten = await listen<any>("bridge-message", (event) => {
      const msg = event.payload;
      if (msg?.type === "slop-relay" && msg.tabId === tabId && msg.message) {
        const slopMsg = msg.message as SlopMessage;
        for (const h of messageHandlers) h(slopMsg);
      }
    });

    // Send the initial connect handshake through the bridge
    await invoke("bridge_send", {
      message: { type: "slop-relay", tabId, message: { type: "connect" } },
    });

    return {
      send(message: SlopMessage) {
        invoke("bridge_send", {
          message: { type: "slop-relay", tabId, message },
        }).catch(() => {});
      },
      onMessage(handler: MessageHandler) {
        messageHandlers.push(handler);
      },
      onClose(handler: () => void) {
        closeHandlers.push(handler);
      },
      close() {
        unlisten();
        for (const h of closeHandlers) h();
      },
    };
  }
}
