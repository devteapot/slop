import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createDiscoveryService } from "./discovery";
import { registerSlopTools } from "./tools";

export default definePluginEntry({
  id: "slop",
  name: "App Control",
  description:
    "Observe and control desktop and web applications running on this computer. " +
    "Applications that support external control are discovered automatically and " +
    "become available through connected_apps and app_action tools.",
  register(api) {
    const discovery = createDiscoveryService(api.logger);
    registerSlopTools(api, discovery);
    discovery.start();
    api.logger.info("[slop] App control plugin loaded — discovering applications");
  },
});
