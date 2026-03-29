import { discoverSlop, observeDiscovery, type SlopDiscovery } from "./discovery";
import { startBridge } from "./bridge";
import { createChatUI } from "../ui/chat";
import { buildAxTree, observeChanges, executeAction } from "./ax-adapter";
import type { BackgroundMessage, ContentMessage } from "../shared/messages";

let port: chrome.runtime.Port | null = null;
let chatUI: ReturnType<typeof createChatUI> | null = null;
let currentDiscovery: SlopDiscovery | null = null;
let isActive = true;
let axCleanup: (() => void) | null = null;

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
  const host = document.getElementById("slop-extension-root");
  if (host) host.remove();
  chatUI = null;
}

// --- Tier 3: Accessibility adapter (triggered from popup) ---

function startAxAdapter() {
  if (port) return; // already connected

  port = chrome.runtime.connect({ name: "slop" });

  // Announce to background (enables bridge to desktop)
  port.postMessage({
    type: "slop-discovered",
    transport: "postmessage",
  } satisfies ContentMessage);

  // Build initial tree and send as synthetic provider
  const tree = buildAxTree();
  let version = 1;

  port.postMessage({
    type: "slop-from-provider",
    message: {
      type: "hello",
      provider: {
        id: "ax-adapter",
        name: document.title || "Page",
        slop_version: "0.1",
        capabilities: ["state", "affordances"],
      },
    },
  } satisfies ContentMessage);

  port.postMessage({
    type: "slop-from-provider",
    message: { type: "snapshot", id: "sub-1", version, tree },
  } satisfies ContentMessage);

  // Watch for DOM changes
  axCleanup = observeChanges((newTree) => {
    version++;
    port?.postMessage({
      type: "slop-from-provider",
      message: { type: "snapshot", id: "sub-1", version, tree: newTree },
    } satisfies ContentMessage);
  });

  // Handle invoke messages (AI clicking buttons, filling forms, etc.)
  port.onMessage.addListener((msg: any) => {
    if (msg.type === "slop-to-provider" && msg.message?.type === "invoke") {
      const { id, path, action, params } = msg.message;
      // Extract the element ID from the path (last segment)
      const nodeId = path.split("/").pop() ?? path.replace(/^\//, "");
      const result = executeAction(nodeId, action, params);
      port?.postMessage({
        type: "slop-from-provider",
        message: {
          type: "result",
          id,
          status: result.status === "ok" ? "ok" : "error",
          ...(result.status === "ok" ? {} : { error: { code: "internal", message: result.message ?? "Unknown error" } }),
        },
      } satisfies ContentMessage);

      // After action, rebuild tree and send update
      setTimeout(() => {
        version++;
        const updated = buildAxTree();
        port?.postMessage({
          type: "slop-from-provider",
          message: { type: "snapshot", id: "sub-1", version, tree: updated },
        } satisfies ContentMessage);
      }, 100);
    }

    // Handle connect (from desktop via bridge)
    if (msg.type === "slop-to-provider" && msg.message?.type === "connect") {
      port?.postMessage({
        type: "slop-from-provider",
        message: {
          type: "hello",
          provider: {
            id: "ax-adapter",
            name: document.title || "Page",
            slop_version: "0.1",
            capabilities: ["state", "affordances"],
          },
        },
      } satisfies ContentMessage);
    }

    // Handle subscribe (from background after connectTab or from desktop via bridge)
    if (msg.type === "slop-to-provider" && msg.message?.type === "subscribe") {
      const subTree = buildAxTree();
      port?.postMessage({
        type: "slop-from-provider",
        message: { type: "snapshot", id: msg.message.id, version, tree: subTree },
      } satisfies ContentMessage);
    }
  });

  // Show chat UI
  chrome.storage.local.get("prefs", (result) => {
    const chatEnabled = result.prefs?.chatUIEnabled ?? true;
    if (chatEnabled) showChatUI();
  });

  port.onDisconnect.addListener(() => {
    chatUI?.setStatus("disconnected");
    stopAxAdapter();
  });

  // Listen for background messages (same as Tier 1)
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
}

function stopAxAdapter() {
  if (axCleanup) { axCleanup(); axCleanup = null; }
  hideChatUI();
  if (port) { port.disconnect(); port = null; }
}

// Listen for scan/stop messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "scan-page") {
    if (!isActive) { sendResponse({ status: "inactive" }); return; }
    startAxAdapter();
    sendResponse({ status: "scanning" });
  }
  if (msg.type === "stop-scan") {
    stopAxAdapter();
    sendResponse({ status: "stopped" });
  }
  if (msg.type === "get-scan-status") {
    sendResponse({ scanning: !!axCleanup, hasSlop: !!currentDiscovery });
  }
});

init();
