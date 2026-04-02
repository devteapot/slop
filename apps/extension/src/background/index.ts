import type { PortMessageFromContent } from "../types";
import { getActiveProfile } from "../types";
import * as tabRegistry from "./tab-registry";
import * as bridge from "./bridge-client";
import { getStorage, saveStorage, fetchModels, setActiveModel } from "./llm";

// Keep MV3 service worker alive while tabs are connected.
// chrome.alarms is the official MV3 keepalive mechanism —
// empty setInterval callbacks may not prevent worker termination.
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {});

// --- Port connections ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "slop") return;

  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  tabRegistry.register(tabId, port);

  const handlePortMessage = async (msg: PortMessageFromContent) => {
    switch (msg.type) {
      // SDK's PostMessageClientTransport handles "slop-from-provider" directly
      // on the port. We also catch it here for desktop bridge relay.
      case "slop-from-provider":
        tabRegistry.relayUp(tabId, msg.message);
        return;
      case "discovered":
        tabRegistry.setDiscoveries(tabId, msg.providers);
        break;

      case "lost":
        tabRegistry.teardown(tabId);
        break;

      case "send":
        await tabRegistry.handleUserMessage(tabId, msg.text);
        break;

      case "get-profiles": {
        const storage = await getStorage();
        port.postMessage({
          type: "profiles",
          profiles: storage.profiles,
          activeId: storage.activeProfileId,
        });
        break;
      }

      case "set-profile": {
        const storage = await getStorage();
        if (storage.profiles.some((p) => p.id === msg.profileId)) {
          storage.activeProfileId = msg.profileId;
          await saveStorage(storage);
          port.postMessage({
            type: "profiles",
            profiles: storage.profiles,
            activeId: storage.activeProfileId,
          });
          const models = await fetchModels();
          const profile = getActiveProfile(storage);
          port.postMessage({ type: "models", models, active: profile.model });
        }
        break;
      }

      case "get-models": {
        const models = await fetchModels();
        const storage = await getStorage();
        const profile = getActiveProfile(storage);
        port.postMessage({ type: "models", models, active: profile.model });
        break;
      }

      case "set-model":
        await setActiveModel(msg.model);
        port.postMessage({ type: "models", models: [], active: msg.model });
        break;

    }
  };

  port.onMessage.addListener((message) => {
    if (!isPortMessageFromContent(message)) return;
    void handlePortMessage(message);
  });

  port.onDisconnect.addListener(() => {
    tabRegistry.teardown(tabId);
  });
});

// --- Tab removal ---

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRegistry.teardown(tabId);
});

// --- Bridge ---

bridge.start();
bridge.onMessage((msg) => tabRegistry.handleBridgeMessage(msg));
bridge.onConnect(() => tabRegistry.reannounceAll());

function isPortMessageFromContent(value: unknown): value is PortMessageFromContent {
  return !!value
    && typeof value === "object"
    && typeof (value as { type?: unknown }).type === "string";
}
