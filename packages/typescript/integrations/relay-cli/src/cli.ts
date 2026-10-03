#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRelayBridge } from "./bridge";
import { DEFAULT_RELAY_URL } from "./protocol";

const VERSION = readPackageVersion();

type CliOptions = {
  command?: "login";
  url: string;
  token?: string;
  verbose: boolean;
};

const log = {
  info: (...args: unknown[]) => console.error("[slop-relay]", ...args),
  error: (...args: unknown[]) => console.error("[slop-relay] ERROR:", ...args),
};

function printHelp(): void {
  console.log(`slop-relay ${VERSION}

Run a local SLOP relay agent that connects outbound to a hosted bridge.

Usage:
  slop-relay [--url <wss>] [--token <token>] [--verbose]
  slop-relay login
  slop-relay --help
  slop-relay --version

Configuration:
  --url       Bridge WebSocket URL. Defaults to ${DEFAULT_RELAY_URL}
  --token     Relay token. Falls back to SLOP_RELAY_TOKEN or ~/.slop/relay.json
  --verbose   Print connection lifecycle logs
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

function parseArgs(argv: string[]): CliOptions | null {
  let command: CliOptions["command"];
  let url = process.env.SLOP_RELAY_URL ?? DEFAULT_RELAY_URL;
  let token = process.env.SLOP_RELAY_TOKEN;
  let verbose = false;

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
    if (arg === "login") {
      command = "login";
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--url") {
      const value = argv[++index];
      if (!value) throw new Error("Missing value for --url");
      url = value;
      continue;
    }
    if (arg === "--token") {
      const value = argv[++index];
      if (!value) throw new Error("Missing value for --token");
      token = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { command, url, token: token ?? readTokenFile(), verbose };
}

function readTokenFile(): string | undefined {
  const path = join(homedir(), ".slop", "relay.json");
  if (!existsSync(path)) return undefined;
  try {
    const json = JSON.parse(readFileSync(path, "utf8")) as { token?: unknown };
    return typeof json.token === "string" && json.token ? json.token : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;

  if (options.command === "login") {
    console.error("Relay login is coming soon. For now, set SLOP_RELAY_TOKEN or pass --token.");
    return;
  }

  if (!options.token) {
    console.error("No token. Run slop-relay login (coming soon) or set SLOP_RELAY_TOKEN.");
    process.exit(1);
  }

  const logger = options.verbose ? log : { info: () => {}, error: log.error };
  const bridge = createRelayBridge({
    url: options.url,
    token: options.token,
    relayVersion: VERSION,
    logger,
  });

  bridge.start();
  logger.info(`Connected relay agent starting for ${options.url}`);

  const stop = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  log.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
