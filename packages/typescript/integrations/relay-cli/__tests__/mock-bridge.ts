import WebSocket, { WebSocketServer } from "ws";
import type { Down, Up } from "../src/protocol";

export class MockRelayBridge {
  private server: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  readonly frames: Up[] = [];

  constructor(private readonly port: number) {}

  get url(): string {
    return `ws://127.0.0.1:${this.port}/relay`;
  }

  async start(): Promise<void> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: this.port, path: "/relay" });
    this.server = server;
    server.on("connection", (socket) => {
      this.socket = socket;
      socket.on("message", (raw) => {
        this.frames.push(JSON.parse(raw.toString()) as Up);
      });
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));
  }

  send(frame: Down): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Mock bridge has no open socket");
    }
    this.socket.send(JSON.stringify(frame));
  }

  async close(): Promise<void> {
    for (const client of this.server?.clients ?? []) {
      client.terminate();
    }
    if (!this.server) return;
    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      server.close((error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    });
    this.server = null;
    this.socket = null;
  }
}
