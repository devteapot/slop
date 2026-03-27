import type { ClientTransport, Connection } from "@slop/types";
import { spawn } from "node:child_process";
import { createNdjsonConnection } from "./ndjson";

/** Spawns a provider as a child process and communicates over stdin/stdout */
export class StdioClientTransport implements ClientTransport {
  constructor(private command: string[]) {}

  async connect(): Promise<Connection> {
    const proc = spawn(this.command[0], this.command.slice(1), {
      stdio: ["pipe", "pipe", "inherit"],
    });
    return createNdjsonConnection(proc.stdout!, proc.stdin!);
  }
}
