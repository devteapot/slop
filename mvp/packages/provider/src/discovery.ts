import type { ProviderDescriptor } from "@slop/types";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SLOP_DIR = join(homedir(), ".slop", "providers");

export function registerProvider(descriptor: ProviderDescriptor): void {
  mkdirSync(SLOP_DIR, { recursive: true });
  writeFileSync(
    join(SLOP_DIR, `${descriptor.id}.json`),
    JSON.stringify(descriptor, null, 2)
  );
}

export function unregisterProvider(id: string): void {
  const file = join(SLOP_DIR, `${id}.json`);
  if (existsSync(file)) unlinkSync(file);
}
