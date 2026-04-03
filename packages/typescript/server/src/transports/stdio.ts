import { createInterface } from "node:readline";
import type { SlopServer, Connection } from "../server";

/**
 * Listen for a single SLOP consumer on stdin/stdout (NDJSON).
 *
 * ```ts
 * import { listenStdio } from "@slop-ai/server/stdio";
 * listenStdio(slop);
 * ```
 */
export function listenStdio(slop: SlopServer): { close: () => void } {
  const rl = createInterface({ input: process.stdin });

  const conn: Connection = {
    send(message: unknown) {
      process.stdout.write(JSON.stringify(message) + "\n");
    },
    close() {
      rl.close();
    },
  };

  slop.handleConnection(conn);

  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      slop.handleMessage(conn, msg);
    } catch (e) {
      console.warn("[slop] failed to parse stdio message:", e);
    }
  });

  rl.on("close", () => {
    slop.handleDisconnect(conn);
  });

  return {
    close() {
      rl.close();
      slop.handleDisconnect(conn);
    },
  };
}
