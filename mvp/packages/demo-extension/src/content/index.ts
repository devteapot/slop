import { discoverSlop, observeDiscovery, type SlopDiscovery } from "./discovery";
import { startBridge } from "./bridge";
import { createChatUI } from "../ui/chat";
import type { BackgroundMessage, ContentMessage } from "../shared/messages";

let port: chrome.runtime.Port | null = null;
let chatUI: ReturnType<typeof createChatUI> | null = null;

function init() {
  // Try immediate discovery
  const discovery = discoverSlop();
  if (discovery) {
    setup(discovery);
  } else {
    // Watch for dynamic meta tag (SPAs)
    observeDiscovery((d) => setup(d));
  }
}

function setup(discovery: SlopDiscovery) {
  // Connect to background
  port = chrome.runtime.connect({ name: "slop" });

  // Set up postMessage bridge if needed
  if (discovery.transport === "postmessage") {
    startBridge(port);
  }

  // Create chat UI
  chatUI = createChatUI({
    onSendMessage: (text) => {
      port?.postMessage({ type: "user-message", text } satisfies ContentMessage);
    },
    onRequestState: () => {
      port?.postMessage({ type: "get-state" } satisfies ContentMessage);
    },
    onSwitchProfile: (profileId) => {
      port?.postMessage({ type: "set-active-profile", profileId } satisfies ContentMessage);
    },
    onRequestProfiles: () => {
      port?.postMessage({ type: "get-profiles" } satisfies ContentMessage);
    },
    onFetchModels: () => {
      port?.postMessage({ type: "fetch-models" } satisfies ContentMessage);
    },
    onSelectModel: (model) => {
      port?.postMessage({ type: "set-model", model } satisfies ContentMessage);
    },
  });

  // Listen for background messages
  port.onMessage.addListener((msg: BackgroundMessage) => {
    if (!chatUI) return;

    switch (msg.type) {
      case "connection-status":
        chatUI.setStatus(msg.status, msg.providerName);
        break;
      case "state-update":
        chatUI.setTree(msg.formattedTree, msg.toolCount);
        break;
      case "chat-message":
        chatUI.addMessage(msg.role, msg.content);
        break;
      case "chat-done":
        chatUI.setInputEnabled(true);
        break;
      case "chat-error":
        chatUI.addMessage("assistant", `Error: ${msg.message}`);
        chatUI.setInputEnabled(true);
        break;
      case "profiles":
        chatUI.setProfiles(msg.profiles, msg.activeProfileId);
        break;
      case "models":
        chatUI.setModels(msg.models, msg.activeModel);
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    chatUI?.setStatus("disconnected");
  });

  // Notify background of discovery
  port.postMessage({
    type: "slop-discovered",
    transport: discovery.transport,
    endpoint: discovery.endpoint,
  } satisfies ContentMessage);
}

init();
