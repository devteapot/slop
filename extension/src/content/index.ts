import { discoverSlop, observeDiscovery, type SlopDiscovery } from "./discovery";
import { startBridge } from "./bridge";
import { createChatUI } from "../ui/chat";
import type { BackgroundMessage, ContentMessage } from "../shared/messages";

let port: chrome.runtime.Port | null = null;
let chatUI: ReturnType<typeof createChatUI> | null = null;
let currentDiscovery: SlopDiscovery | null = null;
let isActive = true;

async function init() {
  // Check master toggle
  const result = await chrome.storage.local.get("prefs");
  isActive = result.prefs?.active ?? true;

  const discovery = discoverSlop();
  if (discovery) {
    currentDiscovery = discovery;
    if (isActive) setup(discovery);
  } else {
    observeDiscovery((d) => {
      currentDiscovery = d;
      if (isActive) setup(d);
    });
  }

  // React to master toggle changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.prefs) {
      const newActive = changes.prefs.newValue?.active ?? true;
      if (newActive && !isActive && currentDiscovery) {
        isActive = true;
        setup(currentDiscovery);
      } else if (!newActive && isActive) {
        isActive = false;
        teardown();
      }
    }
  });
}

function teardown() {
  hideChatUI();
  if (port) {
    port.postMessage({ type: "slop-lost" } satisfies ContentMessage);
    port.disconnect();
    port = null;
  }
}

function setup(discovery: SlopDiscovery) {
  if (port) return; // already set up

  // Connect to background
  port = chrome.runtime.connect({ name: "slop" });

  // Set up postMessage bridge if needed
  if (discovery.transport === "postmessage") {
    startBridge(port);
  }

  // Listen for background messages (always — chat UI checks for null)
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

  // Notify background of discovery (always — needed for bridge)
  port.postMessage({
    type: "slop-discovered",
    transport: discovery.transport,
    endpoint: discovery.endpoint,
  } satisfies ContentMessage);

  // Create or hide chat UI based on prefs
  chrome.storage.local.get("prefs", (result) => {
    const chatEnabled = result.prefs?.chatUIEnabled ?? true;
    if (chatEnabled) showChatUI();
  });

  // React to chat overlay toggle instantly (only when active)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.prefs) return;
    const newPrefs = changes.prefs.newValue;
    // Check active from the new prefs, not the variable (avoids race)
    if (!(newPrefs?.active ?? true)) return;
    if (newPrefs?.chatUIEnabled) {
      showChatUI();
    } else {
      hideChatUI();
    }
  });
}

function showChatUI() {
  if (chatUI) return; // already showing

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

  // Request current status so the UI is up to date
  port?.postMessage({ type: "get-status" } satisfies ContentMessage);
  port?.postMessage({ type: "get-profiles" } satisfies ContentMessage);
  port?.postMessage({ type: "fetch-models" } satisfies ContentMessage);
}

function hideChatUI() {
  if (!chatUI) return;
  // Remove the shadow DOM host from the page
  const host = document.getElementById("slop-extension-root");
  if (host) host.remove();
  chatUI = null;
}

init();
