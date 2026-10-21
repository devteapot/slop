import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";

export interface JsonlWriterOpts {
  append?: boolean;
}

export class JsonlWriter {
  private stream: WriteStream | null = null;

  constructor(private readonly path: string, private readonly opts: JsonlWriterOpts = {}) {}

  open() {
    mkdirSync(dirname(this.path), { recursive: true });
    // Default: truncate on open so re-running a sweep with the same id starts
    // fresh. Pass {append: true} to accumulate across runs.
    this.stream = createWriteStream(this.path, { flags: this.opts.append ? "a" : "w" });
  }

  write(record: unknown) {
    if (!this.stream) throw new Error("JsonlWriter not opened");
    this.stream.write(`${JSON.stringify(record)}\n`);
  }

  async close() {
    if (!this.stream) return;
    await new Promise<void>((resolve, reject) => {
      this.stream!.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    this.stream = null;
  }
}
