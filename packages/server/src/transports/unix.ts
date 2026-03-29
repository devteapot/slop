import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { SlopServer, Connection } from "../server";

export interface ListenUnixOptions {
  /** Register in ~/.slop/providers/ for discovery. Defaults to false. */
  register?: boolean;
}

/**
 * Listen for SLOP consumers on a Unix domain socket.
 *
 * ```ts
 * import { listenUnix } from "@slop-ai/server/unix";
 * listenUnix(slop, "/tmp/slop/my-app.sock", { register: true });
 * ```
 */
export function listenUnix(
  slop: SlopServer,
  socketPath: string,
  options: ListenUnixOptions = {}
): { close: () => void } {
  // Clean up stale socket
  try { unlinkSync(socketPath); } catch {}
  mkdirSync(dirname(socketPath), { recursive: true });

  const server = createServer((socket: Socket) => {
    const conn = createNdjsonConnection(socket);
    slop.handleConnection(conn);

    conn.onMessage((msg: any) => {
      slop.handleMessage(conn, msg);
    });

    conn.onClose(() => {
      slop.handleDisconnect(conn);
    });
  });

  server.listen(socketPath, () => {
    if (options.register) {
      registerProvider(slop.id, slop.name, socketPath);
    }
  });

  return {
    close() {
      server.close();
      try { unlinkSync(socketPath); } catch {}
      if (options.register) {
        unregisterProvider(slop.id);
      }
    },
  };
}

// --- NDJSON connection ---

interface NdjsonConnection extends Connection {
  onMessage(handler: (msg: any) => void): void;
  onClose(handler: () => void): void;
}

function createNdjsonConnection(socket: Socket): NdjsonConnection {
  const messageHandlers: ((msg: any) => void)[] = [];
  const closeHandlers: (() => void)[] = [];

  const rl = createInterface({ input: socket });

  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      for (const h of messageHandlers) h(msg);
    } catch {}
  });

  rl.on("close", () => {
    for (const h of closeHandlers) h();
  });

  return {
    send(message: unknown) {
      if (!socket.destroyed) {
        socket.write(JSON.stringify(message) + "\n");
      }
    },
    close() {
      socket.end();
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
  };
}

// --- Provider discovery ---

function getDiscoveryDir(): string {
  return join(homedir(), ".slop", "providers");
}

function registerProvider(id: string, name: string, socketPath: string): void {
  const dir = getDiscoveryDir();
  mkdirSync(dir, { recursive: true });
  const descriptor = {
    id,
    name,
    slop_version: "0.1",
    transport: { type: "unix", path: socketPath },
    pid: process.pid,
    capabilities: ["state", "patches", "affordances"],
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(descriptor, null, 2));
}

function unregisterProvider(id: string): void {
  const filePath = join(getDiscoveryDir(), `${id}.json`);
  try { unlinkSync(filePath); } catch {}
}
