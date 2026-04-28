import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildSlopContext } from "@slop-ai/discovery/context";
import { createDiscoveryService } from "@slop-ai/discovery/service";
import { createToolHandlers } from "@slop-ai/discovery/tools";
import { registerSlopTools } from "./tools";

export default definePluginEntry({
  id: "slop",
  name: "App Control",
  description:
    "Observe and control desktop and web applications running on this computer. " +
    "Applications that support external control are discovered automatically and " +
    "become available through list_apps, connect_app, app_action, app_action_batch, and disconnect_app tools.",
  register(api) {
    const discovery = createDiscoveryService({ logger: api.logger });
    const handlers = createToolHandlers(discovery);

    registerSlopTools(api, discovery, handlers);

    // State injection: inject connected providers' state into the prompt
    // before each inference, so the model sees live app state without tool calls.
    //
    // Note: spec/integrations/llm-context.md recommends placing the state tail
    // *after* the stable history so prefix caches still hit. OpenClaw's plugin
    // API only exposes `prependContext`, so we accept the suboptimal placement
    // until OpenClaw grows an append/suffix hook. Functionally this still
    // gives the model fresh state on every turn; it just doesn't preserve
    // upstream prompt caches as cleanly as the recommended placement.
    api.on("before_prompt_build", () => {
      const { stateTail, availableAppsTail } = buildSlopContext(discovery);
      const parts = [stateTail, availableAppsTail].filter((t): t is string => !!t);
      if (parts.length === 0) return {};
      return { prependContext: parts.join("\n\n") };
    });

    discovery.start();
    api.logger.info("[slop] App control plugin loaded — discovering applications");
  },
});
