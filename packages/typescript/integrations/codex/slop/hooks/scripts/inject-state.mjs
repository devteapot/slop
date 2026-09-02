#!/usr/bin/env node

/**
 * Hook script: emits the framed SLOP context written by slop-bridge.
 *
 * The bridge owns rendering — this script is just a stale-aware reader.
 * Outputs nothing if the file is missing, empty, or older than the freshness
 * threshold. Stale-detection uses file mtime, no JSON parsing.
 */

import fs from "node:fs";

const CONTEXT_FILE = "/tmp/codex-slop-plugin/context.txt";
const STALE_THRESHOLD_MS = 30_000;

try {
  if (!fs.existsSync(CONTEXT_FILE)) process.exit(0);

  const stat = fs.statSync(CONTEXT_FILE);
  if (Date.now() - stat.mtimeMs > STALE_THRESHOLD_MS) process.exit(0);

  const content = fs.readFileSync(CONTEXT_FILE, "utf-8");
  if (content.trim().length === 0) process.exit(0);

  process.stdout.write(content);
} catch {
  process.exit(0);
}
