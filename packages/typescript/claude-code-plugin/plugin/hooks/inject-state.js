#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Consume stdin (required by hook protocol)
process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) process.exit(0);

  const cachePath = join(dataDir, "state-cache.txt");
  try {
    const stat = statSync(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    // Skip if older than 60 seconds (MCP server likely not running)
    if (ageMs > 60_000) process.exit(0);

    const content = readFileSync(cachePath, "utf-8").trim();
    if (!content) process.exit(0);

    const output = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: content,
      },
    };
    process.stdout.write(JSON.stringify(output));
  } catch {
    // File doesn't exist or can't be read — no state to inject
  }
  process.exit(0);
});
