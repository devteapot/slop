import type { ProviderDescriptor, ClientTransport } from "@slop/types";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { UnixClientTransport } from "./transport/unix";
import { StdioClientTransport } from "./transport/stdio";

const SLOP_DIR = join(homedir(), ".slop", "providers");

export function listProviders(): ProviderDescriptor[] {
  if (!existsSync(SLOP_DIR)) return [];
  return readdirSync(SLOP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(SLOP_DIR, f), "utf-8")));
}

export function findProvider(id: string): ProviderDescriptor | null {
  const file = join(SLOP_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function transportForDescriptor(
  desc: ProviderDescriptor
): ClientTransport {
  switch (desc.transport.type) {
    case "unix":
      return new UnixClientTransport(desc.transport.path!);
    case "stdio":
      return new StdioClientTransport(desc.transport.command!);
    default:
      throw new Error(`Unsupported transport: ${desc.transport.type}`);
  }
}
