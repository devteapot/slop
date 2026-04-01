import { discoverSlop, observeDiscovery, type SlopDiscovery } from "./discovery";
import { createBridgeRelay } from "./bridge-relay";
import { createChatUI } from "../ui/chat";
import { buildAxTree, observeChanges, executeAction } from "./ax-adapter";
import type { BackgroundMessage, ContentMessage } from "../types";

let port: chrome.runtime.Port | null = null;
let bridgeRelay: ReturnType<typeof createBridgeRelay> | null = null;
let chatUI: ReturnType<typeof createChatUI> | null = null;
let currentDiscoveries: SlopDiscovery[] = [];
let isActive = true;
let axCleanup: (() => void) | null = null;
let reconnecting = false;

// ========================================================================
// Init
// ========================================================================

async function init() {
  const result = await chrome.storage.local.get("prefs");
  isActive = result.prefs?.active ?? true;

  currentDiscoveries = discoverSlop();

  observeDiscovery((ds) => {
    const isNew = ds.length > currentDiscoveries.length;
    currentDiscoveries = ds;
    if (!isActive) return;

    if (!port && ds.length > 0) {
      connectPort();
    } else if (port && isNew) {
      sendDiscoveries();
    }
  });

  if (currentDiscoveries.length > 0 && isActive) {
    connectPort();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.prefs) return;
    const newActive = changes.prefs.newValue?.active ?? true;
    if (newActive && !isActive && currentDiscoveries.length > 0) {
      isActive = true;
      connectPort();
    } else if (!newActive && isActive) {
      isActive = false;
      teardown();
    }
    // Chat UI toggle
    if (isActive && port) {
      const chatEnabled = changes.prefs.newValue?.chatUIEnabled ?? true;
      if (chatEnabled) showChatUI();
      else hideChatUI();
    }
  });
}

// ========================================================================
// Port lifecycle
// ========================================================================

function connectPort() {
  if (port) return;

  port = chrome.runtime.connect({ name: "slop" });
  bridgeRelay = createBridgeRelay(port);

  port.onMessage.addListener(handleBackgroundMessage);

  port.onDisconnect.addListener(() => {
    bridgeRelay?.dispose();
    bridgeRelay = null;
    port = null;
    chatUI?.setStatus("disconnected");

    if (isActive && currentDiscoveries.length > 0 && !reconnecting) {
      reconnecting = true;
      setTimeout(() => {
        reconnecting = false;
        if (isActive && currentDiscoveries.length > 0) connectPort();
      }, 500);
    }
  });

  sendDiscoveries();

  chrome.storage.local.get("prefs", (result) => {
    if (result.prefs?.chatUIEnabled ?? true) showChatUI();
  });
}

function teardown() {
  hideChatUI();
  if (port) {
    port.postMessage({ type: "lost" } satisfies ContentMessage);
    port.disconnect();
    port = null;
  }
  bridgeRelay?.dispose();
  bridgeRelay = null;
}

function sendDiscoveries() {
  port?.postMessage({
    type: "discovered",
    providers: currentDiscoveries.map((d) => ({ transport: d.transport, endpoint: d.endpoint })),
  } satisfies ContentMessage);
}

// ========================================================================
// Background message handler
// ========================================================================

function handleBackgroundMessage(msg: BackgroundMessage) {
  if (!chatUI) return;
  switch (msg.type) {
    case "status":
      chatUI.setStatus(msg.status, msg.providerName);
      break;
    case "tree":
      chatUI.setTree(msg.formatted, msg.toolCount);
      break;
    case "assistant":
      chatUI.addMessage("assistant", msg.content);
      break;
    case "progress":
      chatUI.addMessage("tool-progress", msg.content);
      break;
    case "error":
      chatUI.addMessage("assistant", `Error: ${msg.message}`);
      chatUI.setInputEnabled(true);
      break;
    case "input-ready":
      chatUI.setInputEnabled(true);
      break;
    case "profiles":
      chatUI.setProfiles(msg.profiles, msg.activeId);
      break;
    case "models":
      chatUI.setModels(msg.models, msg.active);
      break;
  }
}

// ========================================================================
// Chat UI
// ========================================================================

function showChatUI() {
  if (chatUI) return;

  chatUI = createChatUI({
    onSendMessage: (text) => {
      port?.postMessage({ type: "send", text } satisfies ContentMessage);
    },
    onSwitchProfile: (profileId) => {
      port?.postMessage({ type: "set-profile", profileId } satisfies ContentMessage);
    },
    onSelectModel: (model) => {
      port?.postMessage({ type: "set-model", model } satisfies ContentMessage);
    },
  });

  // Request initial state
  port?.postMessage({ type: "get-profiles" } satisfies ContentMessage);
  port?.postMessage({ type: "get-models" } satisfies ContentMessage);
}

function hideChatUI() {
  chatUI?.destroy();
  chatUI = null;
}

// ========================================================================
// AX Adapter (Tier 2/3 — triggered from popup)
// ========================================================================

function startAxAdapter() {
  if (port) return;

  port = chrome.runtime.connect({ name: "slop" });

  port.postMessage({
    type: "discovered",
    providers: [{ transport: "postmessage" as const }],
  } satisfies ContentMessage);

  const tree = buildAxTree();
  let version = 1;

  // AX adapter acts as a postMessage provider — use SDK-compatible message types
  const slopUp = (message: any) =>
    port?.postMessage({ type: "slop-from-provider", message });

  slopUp({
    type: "hello",
    provider: { id: "ax-adapter", name: document.title || "Page", slop_version: "0.1", capabilities: ["state", "affordances"] },
  });

  slopUp({ type: "snapshot", id: "sub-1", version, tree });

  axCleanup = observeChanges((newTree) => {
    version++;
    slopUp({ type: "snapshot", id: "sub-1", version, tree: newTree });
  });

  port.onMessage.addListener((msg: any) => {
    if (msg.type === "slop-to-provider" && msg.message?.type === "invoke") {
      const { id, path, action, params } = msg.message;
      const nodeId = path.split("/").pop() ?? path.replace(/^\//, "");
      const result = executeAction(nodeId, action, params);
      slopUp({
        type: "result", id,
        status: result.status === "ok" ? "ok" : "error",
        ...(result.status === "ok" ? {} : { error: { code: "internal", message: result.message ?? "Unknown error" } }),
      });
      setTimeout(() => {
        version++;
        slopUp({ type: "snapshot", id: "sub-1", version, tree: buildAxTree() });
      }, 100);
    }
    if (msg.type === "slop-to-provider" && msg.message?.type === "connect") {
      slopUp({ type: "hello", provider: { id: "ax-adapter", name: document.title || "Page", slop_version: "0.1", capabilities: ["state", "affordances"] } });
    }
    if (msg.type === "slop-to-provider" && msg.message?.type === "subscribe") {
      slopUp({ type: "snapshot", id: msg.message.id, version, tree: buildAxTree() });
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
  bridgeRelay?.dispose();
  bridgeRelay = null;
  if (port) { port.disconnect(); port = null; }
}

// ========================================================================
// Message listener (popup commands)
// ========================================================================

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
