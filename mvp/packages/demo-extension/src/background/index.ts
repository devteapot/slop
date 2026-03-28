import type { ContentMessage } from "../shared/messages";
import { connectTab, disconnectTab, handleUserMessage, getTabState } from "./slop-manager";

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
