import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createDiscoveryService, type DiscoveryService } from "@slop-ai/discovery";
import { createToolHandlers } from "@slop-ai/discovery";
import { formatTree } from "@slop-ai/consumer";
import { registerSlopTools } from "./tools";

function buildStateContext(discovery: DiscoveryService): string | null {
  const connected = discovery.getProviders();
  const discovered = discovery.getDiscovered();
  const connectedIds = new Set(connected.map((p) => p.id));

  const available = discovered.filter((d) => !connectedIds.has(d.id));

  if (connected.length === 0 && available.length === 0) return null;

  let output = "## SLOP Apps\n\n";

  if (connected.length > 0) {
    output += `${connected.length} app(s) connected. `;
    output +=
      "Use app_action or app_action_batch to act on them. Call connect_app to refresh detailed state or disconnect_app when you're done.\n\n";

    for (const p of connected) {
      const tree = p.consumer.getTree(p.subscriptionId);
      output += `### ${p.name} (${p.id})\n\n`;
      if (tree) {
        output += "```\n" + formatTree(tree) + "\n```\n\n";
      } else {
        output += "(awaiting state snapshot)\n\n";
      }
    }
  }

  if (available.length > 0) {
    output += "### Available (not connected)\n\n";
    for (const app of available) {
      output += `- **${app.name}** (id: \`${app.id}\`, ${app.transport.type}, ${app.source ?? "local"})\n`;
    }
    output += "\nCall connect_app with an app name to connect.\n";
  }

  return output;
}

export default definePluginEntry({
  id: "slop",
  name: "App Control",
  description:
    "Observe and control desktop and web applications running on this computer. " +
    "Applications that support external control are discovered automatically and " +
    "become available through discover_apps, connect_app, app_action, app_action_batch, and disconnect_app tools.",
  register(api) {
    const discovery = createDiscoveryService({ logger: api.logger });
    const handlers = createToolHandlers(discovery);

    registerSlopTools(api, discovery, handlers);

    // State injection: inject connected providers' state into the prompt
    // before each inference, so the model sees live app state without tool calls.
    api.on("before_prompt_build", () => {
      const context = buildStateContext(discovery);
      if (!context) return {};
      return { prependContext: context };
    });

    discovery.start();
    api.logger.info("[slop] App control plugin loaded — discovering applications");
  },
});
