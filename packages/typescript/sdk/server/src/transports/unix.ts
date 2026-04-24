import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Connection, SlopServer } from "../server";

/** See spec/core/transport.md §Local discovery. */
const DESCRIPTOR_FILENAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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
  options: ListenUnixOptions = {},
): { close: () => void } {
  // Clean up stale socket
  removeSocketIfPresent(socketPath);
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
    // Lock the socket down before registering — other local users must not be
    // able to connect. Node creates the socket with mode `0777 & ~umask`,
    // which is typically `0755` and therefore world-connectable.
    // See spec/core/transport.md §Security considerations.
    try {
      chmodSync(socketPath, 0o600);
    } catch (e) {
      console.warn(`[slop] failed to chmod socket ${socketPath} to 0600:`, e);
    }
    if (options.register) {
      registerProvider(slop.id, slop.name, socketPath);
    }
  });

  return {
    close() {
      server.close();
      removeSocketIfPresent(socketPath);
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
    } catch (e) {
      console.warn("[slop] failed to parse socket message:", e);
    }
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
  if (!DESCRIPTOR_FILENAME_RE.test(id)) {
    throw new Error(
      `[slop] provider id ${JSON.stringify(id)} is not a valid descriptor filename stem — must match ${DESCRIPTOR_FILENAME_RE}`,
    );
  }
  const dir = getDiscoveryDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const descriptor = {
    id,
    name,
    slop_version: "0.1",
    transport: { type: "unix", path: socketPath },
    pid: process.pid,
    capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
  };

  // Atomic rename: write to a temp file in the same directory, then rename
  // into place. This prevents consumers from observing a partially written
  // descriptor.
  const finalPath = join(dir, `${id}.json`);
  const tmpPath = join(dir, `${id}.json.tmp.${process.pid}`);
  writeFileSync(tmpPath, JSON.stringify(descriptor, null, 2), { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, finalPath);
}

function unregisterProvider(id: string): void {
  if (!DESCRIPTOR_FILENAME_RE.test(id)) return;
  const filePath = join(getDiscoveryDir(), `${id}.json`);
  removeSocketIfPresent(filePath);
}

function removeSocketIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
    if (code !== "ENOENT") {
      console.warn(`[slop] failed to remove stale socket or descriptor at ${path}:`, e);
    }
  }
}
