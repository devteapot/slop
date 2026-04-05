#!/usr/bin/env node

/**
 * Hook script: reads the shared state file written by slop-bridge
 * and outputs connected providers' state trees for context injection.
 *
 * Called by the UserPromptSubmit hook on every user message.
 * Outputs nothing if no providers are connected/discovered or if the state is stale.
 */

import fs from "node:fs";

const STATE_FILE = "/tmp/codex-slop-plugin/state.json";
const STALE_THRESHOLD = 30_000; // 30 seconds

try {
  if (!fs.existsSync(STATE_FILE)) process.exit(0);

  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  const data = JSON.parse(raw);

  if (data.lastUpdated && Date.now() - data.lastUpdated > STALE_THRESHOLD) {
    process.exit(0);
  }

  const hasProviders = data.providers && data.providers.length > 0;
  const hasAvailable = data.available && data.available.length > 0;

  if (!hasProviders && !hasAvailable) process.exit(0);

  let output = "## SLOP Apps\n\n";

  if (hasProviders) {
    output += `${data.providers.length} app(s) connected. `;
    output +=
      "Read the state trees below before acting. Use app_action or app_action_batch to invoke affordances, and call connect_app only when you need to connect a new app or force a refresh.\n\n";

    for (const provider of data.providers) {
      output += `### ${provider.name} (${provider.id})\n\n`;
      if (provider.state && provider.state !== "(no state yet)") {
        output += "```\n" + provider.state + "\n```\n\n";
      } else {
        output += "(awaiting state snapshot)\n\n";
      }
    }
  }

  if (hasAvailable) {
    output += "### Available (not connected)\n\n";
    for (const app of data.available) {
      output += `- **${app.name}** (id: \`${app.id}\`, ${app.transport}, ${app.source})\n`;
    }
    output += "\nCall connect_app with an app name to connect it.\n";
  }

  process.stdout.write(output);
} catch {
  process.exit(0);
}
