import type { Connection, SlopMessage, MessageHandler } from "@slop/types";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export function createNdjsonConnection(
  readable: Readable,
  writable: Writable
): Connection {
  const messageHandlers: MessageHandler[] = [];
  const closeHandlers: (() => void)[] = [];

  const rl = createInterface({ input: readable });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as SlopMessage;
      for (const h of messageHandlers) h(msg);
    } catch {
      // ignore malformed lines
    }
  });
  rl.on("close", () => {
    for (const h of closeHandlers) h();
  });

  return {
    send(message: SlopMessage) {
      writable.write(JSON.stringify(message) + "\n");
    },
    onMessage(handler: MessageHandler) {
      messageHandlers.push(handler);
    },
    onClose(handler: () => void) {
      closeHandlers.push(handler);
    },
    close() {
      rl.close();
      writable.end();
    },
  };
}
