import type { ClientTransport, Connection } from "@slop/types";
import { createConnection } from "node:net";
import { createNdjsonConnection } from "./ndjson";

export class UnixClientTransport implements ClientTransport {
  constructor(private socketPath: string) {}

  async connect(): Promise<Connection> {
    const socket = createConnection(this.socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    return createNdjsonConnection(socket, socket);
  }
}
