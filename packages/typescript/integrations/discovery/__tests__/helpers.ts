import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import WebSocket, { WebSocketServer } from "ws";

export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeTempDir(path: string) {
  rmSync(path, { recursive: true, force: true });
}

export function writeDescriptor(dir: string, fileName: string, descriptor: unknown) {
  writeFileSync(join(dir, fileName), JSON.stringify(descriptor, null, 2));
}

export async function waitUntil(
  fn: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 1000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(intervalMs);
  }

  throw new Error("Condition not met before timeout");
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

export async function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

export async function createMockSlopProviderServer(options: {
  port: number;
  providerId?: string;
  providerName?: string;
  helloDelayMs?: number;
}) {
  const {
    port,
    providerId = "test-provider",
    providerName = "Test Provider",
    helloDelayMs = 0,
  } = options;
  const clients = new Set<WebSocket>();
  let connectionCount = 0;

  const wss = new WebSocketServer({ host: "127.0.0.1", port, path: "/slop" });
  wss.on("connection", (ws) => {
    clients.add(ws);
    connectionCount += 1;

    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "hello",
          provider: {
            id: providerId,
            name: providerName,
            slop_version: "0.1",
            capabilities: [],
          },
        }));
      }
    }, helloDelayMs);

    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === "subscribe") {
        ws.send(JSON.stringify({
          type: "snapshot",
          id: message.id,
          version: 1,
          tree: {
            id: providerId,
            type: "root",
            properties: { label: providerName },
            children: [],
            affordances: [],
          },
        }));
      }
      if (message.type === "invoke") {
        ws.send(JSON.stringify({
          type: "result",
          id: message.id,
          status: "ok",
        }));
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));

  return {
    url: `ws://127.0.0.1:${port}/slop`,
    getConnectionCount: () => connectionCount,
    async close() {
      for (const client of clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
