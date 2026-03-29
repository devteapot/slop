import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "@slop/consumer/browser";

/**
 * Unix socket transport that bridges through Tauri Rust commands.
 * Rust connects to the socket and relays NDJSON messages via Tauri events.
 */
export class UnixClientTransport implements ClientTransport {
  constructor(private socketPath: string) {}

  async connect(): Promise<Connection> {
    const messageHandlers: MessageHandler[] = [];
    const closeHandlers: (() => void)[] = [];
    const unlisteners: UnlistenFn[] = [];
    const buffered: SlopMessage[] = [];

    // Generate a predictable connection ID so we can listen before connecting
    const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Set up event listeners FIRST to avoid missing the hello message
    const unlistenMsg = await listen<SlopMessage>(`slop-message-${connId}`, (event) => {
      if (messageHandlers.length === 0) {
        // Buffer messages until handlers are registered
        buffered.push(event.payload);
      } else {
        for (const h of messageHandlers) h(event.payload);
      }
    });
    unlisteners.push(unlistenMsg);

    const unlistenClose = await listen(`slop-closed-${connId}`, () => {
      for (const h of closeHandlers) h();
      cleanup();
    });
    unlisteners.push(unlistenClose);

    // NOW connect — Rust will use our connId
    await invoke<string>("connect_unix", { socketPath: this.socketPath, connId });

    function cleanup() {
      for (const fn of unlisteners) fn();
    }

    return {
      send(msg: SlopMessage) {
        invoke("send_unix", { connId, message: msg }).catch(() => {});
      },
      onMessage(h: MessageHandler) {
        messageHandlers.push(h);
        // Flush any buffered messages
        while (buffered.length > 0) {
          h(buffered.shift()!);
        }
      },
      onClose(h: () => void) {
        closeHandlers.push(h);
      },
      close() {
        invoke("disconnect_unix", { connId }).catch(() => {});
        cleanup();
      },
    };
  }
}
