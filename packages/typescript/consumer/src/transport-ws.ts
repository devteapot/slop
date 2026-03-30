import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "./types";

export class WebSocketClientTransport implements ClientTransport {
  constructor(private url: string) {}

  async connect(): Promise<Connection> {
    const ws = new WebSocket(this.url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`WebSocket connection failed: ${this.url}`));
    });

    const messageHandlers: MessageHandler[] = [];
    const closeHandlers: (() => void)[] = [];

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as SlopMessage;
        for (const h of messageHandlers) h(msg);
      } catch {}
    };
    ws.onclose = () => {
      for (const h of closeHandlers) h();
    };

    return {
      send(msg) { ws.send(JSON.stringify(msg)); },
      onMessage(h) { messageHandlers.push(h); },
      onClose(h) { closeHandlers.push(h); },
      close() { ws.close(); },
    };
  }
}
