import { writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { formatTree, affordancesToTools } from "@slop-ai/consumer";
import type { DiscoveryService, ConnectedProvider } from "./discovery";

const HEADER = `[SLOP — Connected Applications]

You can SEE application state below and ACT on it using app_action / app_action_batch tools.
Use the exact paths, action names, and parameter shapes shown below.
You can and SHOULD use app_action_batch to perform multiple actions in a single call.
Tools marked [DANGEROUS] require explicit user confirmation before calling.
`;

function formatProviderState(p: ConnectedProvider): string {
  const tree = p.consumer.getTree(p.subscriptionId);
  if (!tree) return `## ${p.name} (id: \`${p.id}\`)\n\n(no state available yet)\n`;

  const toolSet = affordancesToTools(tree);
  const actionsText = toolSet.tools
    .map((t) => {
      const resolved = toolSet.resolve(t.function.name);
      const action = resolved?.action ?? t.function.name;
      const path = resolved?.path ?? "/";
      return `  - **${action}** on \`${path}\`: ${t.function.description}`;
    })
    .join("\n");

  return (
    `## ${p.name} (id: \`${p.id}\`)\n\n` +
    `### State\n\`\`\`\n${formatTree(tree)}\n\`\`\`\n\n` +
    `### Actions (${toolSet.tools.length})\n${actionsText}\n`
  );
}

export interface StateCache {
  start(): void;
  stop(): void;
}

export function createStateCache(
  cacheDir: string,
  discovery: DiscoveryService,
): StateCache {
  const cachePath = join(cacheDir, "state-cache.txt");
  const tmpPath = join(cacheDir, "state-cache.txt.tmp");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function write() {
    const connected = discovery.getProviders();
    if (connected.length === 0) {
      try { unlinkSync(cachePath); } catch {}
      return;
    }

    const sections = connected.map(formatProviderState);
    const content = HEADER + "\n" + sections.join("\n");

    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(tmpPath, content, "utf-8");
      renameSync(tmpPath, cachePath);
    } catch {}
  }

  function scheduleWrite() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(write, 100);
  }

  return {
    start() {
      discovery.onStateChange(scheduleWrite);
      // Write initial state if providers already connected
      write();
    },
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      try { unlinkSync(cachePath); } catch {}
    },
  };
}
