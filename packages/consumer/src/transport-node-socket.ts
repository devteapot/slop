import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { ClientTransport, Connection, SlopMessage, MessageHandler } from "./types";

/**
 * Unix socket transport for Node.js environments.
 * Connects to a SLOP provider via Unix domain socket using NDJSON encoding.
 */
export class NodeSocketClientTransport implements ClientTransport {
  constructor(private socketPath: string) {}

  async connect(): Promise<Connection> {
    const socket = await this.connectSocket();

    const messageHandlers: MessageHandler[] = [];
    const closeHandlers: (() => void)[] = [];

    const rl = createInterface({ input: socket });
    rl.on("line", (line) => {
      if (!line) return;
      try {
        const msg = JSON.parse(line) as SlopMessage;
        for (const h of messageHandlers) h(msg);
      } catch {}
    });

    socket.on("close", () => {
      rl.close();
      for (const h of closeHandlers) h();
    });

    return {
      send(msg: SlopMessage) {
        socket.write(JSON.stringify(msg) + "\n");
      },
      onMessage(h: MessageHandler) {
        messageHandlers.push(h);
      },
      onClose(h: () => void) {
        closeHandlers.push(h);
      },
      close() {
        rl.close();
        socket.end();
      },
    };
  }

  private connectSocket(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", (err) =>
        reject(new Error(`Unix socket connection failed: ${this.socketPath}: ${err.message}`))
      );
    });
  }
}
