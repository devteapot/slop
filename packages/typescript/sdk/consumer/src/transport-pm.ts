import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "./types";

/** Chrome extension runtime port (declared here to avoid @types/chrome dependency) */
interface ChromePort {
  onMessage: { addListener(cb: (msg: any) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  postMessage(msg: any): void;
}

/**
 * PostMessage transport — used in the background service worker.
 * Communicates with the page via a chrome.runtime port that is bridged
 * by the content script.
 */
export class PostMessageClientTransport implements ClientTransport {
  constructor(private port: ChromePort) {}

  async connect(): Promise<Connection> {
    const messageHandlers: MessageHandler[] = [];
    const closeHandlers: (() => void)[] = [];

    this.port.onMessage.addListener((msg: any) => {
      if (msg.type === "slop-from-provider") {
        for (const h of messageHandlers) h(msg.message);
      }
    });

    this.port.onDisconnect.addListener(() => {
      for (const h of closeHandlers) h();
    });

    // Send connect handshake to the page
    this.port.postMessage({
      type: "slop-to-provider",
      message: { type: "connect" },
    });

    return {
      send: (m: SlopMessage) => {
        this.port.postMessage({ type: "slop-to-provider", message: m });
      },
      onMessage: (h: MessageHandler) => { messageHandlers.push(h); },
      onClose: (h: () => void) => { closeHandlers.push(h); },
      close: () => {
        messageHandlers.length = 0;
        closeHandlers.length = 0;
      },
    };
  }
}
