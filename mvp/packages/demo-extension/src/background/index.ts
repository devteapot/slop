import type { ContentMessage } from "../shared/messages";
import { connectTab, disconnectTab, handleUserMessage, getTabState } from "./slop-manager";
import { getStorage, saveStorage, fetchModels, setActiveModel } from "./llm";
import { getActiveProfile } from "../shared/messages";

// Keep service worker alive while there are active connections
// MV3 service workers get killed after 30s of inactivity
setInterval(() => {
  if (ports.size > 0) {
    // noop — just keeps the event loop alive
  }
}, 20000);

// Track ports per tab
const ports = new Map<number, chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "slop") return;

  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  ports.set(tabId, port);

  port.onMessage.addListener(async (msg: ContentMessage) => {
    switch (msg.type) {
      case "slop-discovered":
        await connectTab(tabId, port, msg.transport, msg.endpoint);
        break;

      case "slop-lost":
        disconnectTab(tabId);
        break;

      case "user-message":
        await handleUserMessage(tabId, msg.text);
        break;

      case "get-status": {
        const state = getTabState(tabId);
        port.postMessage({
          type: "connection-status",
          status: state ? "connected" : "disconnected",
          providerName: state?.providerName,
        });
        break;
      }

      case "get-state": {
        const state = getTabState(tabId);
        if (state?.currentTree) {
          const { formatTree, affordancesToTools } = await import("../shared/tools");
          port.postMessage({
            type: "state-update",
            formattedTree: formatTree(state.currentTree),
            toolCount: affordancesToTools(state.currentTree).length,
          });
        }
        break;
      }

      case "get-profiles": {
        const storage = await getStorage();
        port.postMessage({
          type: "profiles",
          profiles: storage.profiles,
          activeProfileId: storage.activeProfileId,
        });
        break;
      }

      case "set-active-profile": {
        const storage = await getStorage();
        if (storage.profiles.some(p => p.id === msg.profileId)) {
          storage.activeProfileId = msg.profileId;
          await saveStorage(storage);
          port.postMessage({
            type: "profiles",
            profiles: storage.profiles,
            activeProfileId: storage.activeProfileId,
          });
          // Auto-fetch models for the new profile
          const models = await fetchModels();
          const profile = getActiveProfile(storage);
          port.postMessage({ type: "models", models, activeModel: profile.model });
        }
        break;
      }

      case "fetch-models": {
        const models = await fetchModels();
        const storage = await getStorage();
        const profile = getActiveProfile(storage);
        port.postMessage({ type: "models", models, activeModel: profile.model });
        break;
      }

      case "set-model": {
        await setActiveModel(msg.model);
        port.postMessage({ type: "models", models: [], activeModel: msg.model });
        break;
      }

      // PostMessage bridge relay
      case "slop-from-provider":
        // This is handled by the PostMessageClientTransport's port listener
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(tabId);
    disconnectTab(tabId);
  });
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  disconnectTab(tabId);
  ports.delete(tabId);
});
