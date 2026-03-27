import type { ServerTransport, Connection } from "@slop/types";
import { createNdjsonConnection } from "./ndjson";

/** Single-connection transport over stdin/stdout (for spawned processes) */
export class StdioServerTransport implements ServerTransport {
  async listen(onConnection: (conn: Connection) => void): Promise<void> {
    const conn = createNdjsonConnection(process.stdin, process.stdout);
    onConnection(conn);
  }

  async close(): Promise<void> {
    // no-op for stdio
  }
}
