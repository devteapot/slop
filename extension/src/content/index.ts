import { discoverSlop, observeDiscovery, type SlopDiscovery } from "./discovery";
import { createBridgeController } from "./bridge";
import { createChatUI } from "../ui/chat";
import { buildAxTree, observeChanges, executeAction } from "./ax-adapter";
import type { BackgroundMessage, ContentMessage } from "../shared/messages";

let port: chrome.runtime.Port | null = null;
let bridgeController: ReturnType<typeof createBridgeController> | null = null;
let chatUI: ReturnType<typeof createChatUI> | null = null;
let currentDiscoveries: SlopDiscovery[] = [];
let isActive = true;
let axCleanup: (() => void) | null = null;
let reconnecting = false;

async function init() {
  const result = await chrome.storage.local.get("prefs");
  isActive = result.prefs?.active ?? true;

  // Initial discovery
  currentDiscoveries = discoverSlop();

  // Watch for new meta tags (SPAs inject postMessage after hydration)
  observeDiscovery((ds) => {
    const isNew = ds.length > currentDiscoveries.length;
    currentDiscoveries = ds;
    if (!isActive) return;

    if (!port && ds.length > 0) {
      connectPort();
    } else if (port && isNew) {
      // New provider appeared — re-announce all
      port.postMessage({
        type: "slop-discovered",
        providers: ds.map((d) => ({ transport: d.transport, endpoint: d.endpoint })),
      } satisfies ContentMessage);
    }
  });

  if (currentDiscoveries.length > 0 && isActive) {
    connectPort();
  }

  // React to master toggle changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.prefs) {
      const newActive = changes.prefs.newValue?.active ?? true;
      if (newActive && !isActive && currentDiscoveries.length > 0) {
        isActive = true;
        connectPort();
      } else if (!newActive && isActive) {
        isActive = false;
        teardown();
      }
    }
  });
}

// --- Port lifecycle with reconnection ---

function connectPort() {
  if (port) return;

  port = chrome.runtime.connect({ name: "slop" });
  bridgeController = createBridgeController(port);

  // Listen for background messages
  port.onMessage.addListener(handleBackgroundMessage);

  // Port reconnection on disconnect (MV3 service worker restart)
  port.onDisconnect.addListener(() => {
    bridgeController?.dispose();
    bridgeController = null;
    port = null;
    chatUI?.setStatus("disconnected");

    if (isActive && currentDiscoveries.length > 0 && !reconnecting) {
      reconnecting = true;
      setTimeout(() => {
        reconnecting = false;
        if (isActive && currentDiscoveries.length > 0) {
          connectPort();
        }
      }, 500);
    }
  });

  // Announce discovered providers
  if (currentDiscoveries.length > 0) {
    port.postMessage({
      type: "slop-discovered",
      providers: currentDiscoveries.map((d) => ({ transport: d.transport, endpoint: d.endpoint })),
    } satisfies ContentMessage);
  }

  // Show chat UI if enabled
  chrome.storage.local.get("prefs", (result) => {
    const chatEnabled = result.prefs?.chatUIEnabled ?? true;
    if (chatEnabled) showChatUI();
  });

  // React to chat overlay toggle
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.prefs) return;
    const newPrefs = changes.prefs.newValue;
    if (!(newPrefs?.active ?? true)) return;
    if (newPrefs?.chatUIEnabled) showChatUI();
    else hideChatUI();
  });
}

function teardown() {
  hideChatUI();
  if (port) {
    port.postMessage({ type: "slop-lost" } satisfies ContentMessage);
    port.disconnect();
    port = null;
  }
  bridgeController?.dispose();
  bridgeController = null;
}

function handleBackgroundMessage(msg: BackgroundMessage) {
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
}

// --- Chat UI ---

function showChatUI() {
  if (chatUI) return;

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
  if (port) return;

  port = chrome.runtime.connect({ name: "slop" });

  port.postMessage({
    type: "slop-discovered",
    providers: [{ transport: "postmessage" as const }],
  } satisfies ContentMessage);

  const tree = buildAxTree();
  let version = 1;

  port.postMessage({
    type: "slop-from-provider",
    message: {
      type: "hello",
      provider: { id: "ax-adapter", name: document.title || "Page", slop_version: "0.1", capabilities: ["state", "affordances"] },
    },
  } satisfies ContentMessage);

  port.postMessage({
    type: "slop-from-provider",
    message: { type: "snapshot", id: "sub-1", version, tree },
  } satisfies ContentMessage);

  axCleanup = observeChanges((newTree) => {
    version++;
    port?.postMessage({
      type: "slop-from-provider",
      message: { type: "snapshot", id: "sub-1", version, tree: newTree },
    } satisfies ContentMessage);
  });

  port.onMessage.addListener((msg: any) => {
    if (msg.type === "slop-to-provider" && msg.message?.type === "invoke") {
      const { id, path, action, params } = msg.message;
      const nodeId = path.split("/").pop() ?? path.replace(/^\//, "");
      const result = executeAction(nodeId, action, params);
      port?.postMessage({
        type: "slop-from-provider",
        message: {
          type: "result", id,
          status: result.status === "ok" ? "ok" : "error",
          ...(result.status === "ok" ? {} : { error: { code: "internal", message: result.message ?? "Unknown error" } }),
        },
      } satisfies ContentMessage);
      setTimeout(() => {
        version++;
        port?.postMessage({
          type: "slop-from-provider",
          message: { type: "snapshot", id: "sub-1", version, tree: buildAxTree() },
        } satisfies ContentMessage);
      }, 100);
    }
    if (msg.type === "slop-to-provider" && msg.message?.type === "connect") {
      port?.postMessage({
        type: "slop-from-provider",
        message: { type: "hello", provider: { id: "ax-adapter", name: document.title || "Page", slop_version: "0.1", capabilities: ["state", "affordances"] } },
      } satisfies ContentMessage);
    }
    if (msg.type === "slop-to-provider" && msg.message?.type === "subscribe") {
      port?.postMessage({
        type: "slop-from-provider",
        message: { type: "snapshot", id: msg.message.id, version, tree: buildAxTree() },
      } satisfies ContentMessage);
    }
  });

  port.onMessage.addListener(handleBackgroundMessage);

  chrome.storage.local.get("prefs", (result) => {
    if (result.prefs?.chatUIEnabled ?? true) showChatUI();
  });

  port.onDisconnect.addListener(() => {
    chatUI?.setStatus("disconnected");
    stopAxAdapter();
  });
}

function stopAxAdapter() {
  if (axCleanup) { axCleanup(); axCleanup = null; }
  hideChatUI();
  bridgeController?.dispose();
  bridgeController = null;
  if (port) { port.disconnect(); port = null; }
}

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
    sendResponse({ scanning: !!axCleanup, hasSlop: currentDiscoveries.length > 0 });
  }
  if (msg.type === "get-slop-status") {
    sendResponse({ hasSlop: currentDiscoveries.length > 0, providers: currentDiscoveries, providerName: document.title });
  }
});

init();
