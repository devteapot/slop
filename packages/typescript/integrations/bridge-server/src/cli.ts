#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { createBridgeServer } from "./http";
import { readTokenRegistryFromEnv } from "./tokens";

const VERSION = readPackageVersion();

const log = {
  info: (...args: unknown[]) => console.error("[slop-bridge]", ...args),
  error: (...args: unknown[]) => console.error("[slop-bridge] ERROR:", ...args),
};

function printHelp(): void {
  console.log(`slop-bridge-server ${VERSION}

Run the hosted SLOP cloud relay bridge.

Usage:
  slop-bridge-server [--port <port>] [--host <host>]
  slop-bridge-server --help
  slop-bridge-server --version

Environment:
  SLOP_BRIDGE_USERS  JSON map of user IDs to { mcpToken, relayToken, label? }
  PORT               Default port when --port is omitted
`);
}

function readPackageVersion(): string {
  try {
    const json = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof json.version === "string" ? json.version : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function parseArgs(argv: string[]): { port: number; host?: string } | null {
  let port = Number(process.env.PORT ?? 8080);
  let host: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return null;
    }
    if (arg === "--version" || arg === "-v") {
      console.log(VERSION);
      return null;
    }
    if (arg === "--port") {
      const value = argv[++index];
      if (!value) throw new Error("Missing value for --port");
      port = Number(value);
      continue;
    }
    if (arg === "--host") {
      const value = argv[++index];
      if (!value) throw new Error("Missing value for --host");
      host = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${port}`);
  }
  return { port, host };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;
  const tokens = readTokenRegistryFromEnv();
  const server = createBridgeServer({
    port: args.port,
    hostname: args.host,
    tokens,
    logger: log,
  });
  log.info(`listening on ${server.url}`);

  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  log.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
