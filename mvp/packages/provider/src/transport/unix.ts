import type { ServerTransport, Connection } from "@slop/types";
import { createServer, type Server } from "node:net";
import { createNdjsonConnection } from "./ndjson";
import { unlinkSync, existsSync } from "node:fs";

export class UnixServerTransport implements ServerTransport {
  private server: Server | null = null;

  constructor(private socketPath: string) {}

  async listen(onConnection: (conn: Connection) => void): Promise<void> {
    // Clean up stale socket file
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    this.server = createServer((socket) => {
      const conn = createNdjsonConnection(socket, socket);
      onConnection(conn);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.on("error", reject);
      this.server!.listen(this.socketPath, resolve);
    });
  }

  async close(): Promise<void> {
    if (this.server) {
      this.server.close();
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }
    }
  }

  getSocketPath(): string {
    return this.socketPath;
  }
}
