import type { ContentMessage } from "../shared/messages";
import { getActiveProfile } from "../shared/messages";
import {
  connectTab,
  disconnectTab,
  getTabConnectionStatus,
  getTabMergedTree,
  getTabState,
  handleUserMessage,
  hasTabSession,
  syncTabDiscoveries,
} from "./slop-manager";
import { getStorage, saveStorage, fetchModels, setActiveModel } from "./llm";
import {
  announceProvider,
  announceProviderGone,
  makeProviderKey,
  onBridgeMessage,
  relayToDesktop,
  startBridgeClient,
  type BridgeDiscoveryProvider,
} from "./bridge";

interface TabDiscovery extends BridgeDiscoveryProvider {
  providerKey: string;
}

const ports = new Map<number, chrome.runtime.Port>();
const discoveriesByTab = new Map<number, TabDiscovery[]>();
const discoveryIndex = new Map<string, { tabId: number; discovery: TabDiscovery }>();
const desktopRelaysByTab = new Map<number, Set<string>>();

setInterval(() => {
  if (ports.size > 0) {
    // Keep the MV3 service worker warm while tabs are actively connected.
  }
}, 20_000);

function updateBridgeControl(tabId: number): void {
  const port = ports.get(tabId);
  if (!port) return;

  const desktopRelayCount = desktopRelaysByTab.get(tabId)?.size ?? 0;
  port.postMessage({
    type: "bridge-control",
    active: hasTabSession(tabId) || desktopRelayCount > 0,
  });
}

function removeDesktopRelay(tabId: number, providerKey: string): void {
  const activeRelays = desktopRelaysByTab.get(tabId);
  if (!activeRelays) return;
  activeRelays.delete(providerKey);
  if (activeRelays.size === 0) {
    desktopRelaysByTab.delete(tabId);
  }
  updateBridgeControl(tabId);
}

function clearTabDiscoveries(tabId: number): void {
  const previous = discoveriesByTab.get(tabId) ?? [];
  for (const discovery of previous) {
    announceProviderGone(tabId, discovery.providerKey);
    discoveryIndex.delete(discovery.providerKey);
    removeDesktopRelay(tabId, discovery.providerKey);
  }
  discoveriesByTab.delete(tabId);
}

function registerDiscoveries(
  tabId: number,
  port: chrome.runtime.Port,
  providers: Array<{ transport: "ws" | "postmessage"; endpoint?: string }>
): void {
  const next = providers.map((provider, index) => ({
    ...provider,
    providerKey: makeProviderKey(tabId, provider, index),
  }));

  const previous = discoveriesByTab.get(tabId) ?? [];
  const nextKeys = new Set(next.map((discovery) => discovery.providerKey));

  for (const discovery of previous) {
    if (!nextKeys.has(discovery.providerKey)) {
      announceProviderGone(tabId, discovery.providerKey);
      discoveryIndex.delete(discovery.providerKey);
      removeDesktopRelay(tabId, discovery.providerKey);
    }
  }

  discoveriesByTab.set(tabId, next);

  for (const discovery of next) {
    discoveryIndex.set(discovery.providerKey, { tabId, discovery });
    announceProvider({
      tabId,
      providerKey: discovery.providerKey,
      provider: {
        id: discovery.providerKey,
        name: port.sender?.tab?.title ?? `Tab ${tabId}`,
        transport: discovery.transport,
        url: discovery.endpoint,
      },
    });
  }
}

async function ensureChatSession(tabId: number, port: chrome.runtime.Port): Promise<boolean> {
  if (hasTabSession(tabId)) {
    updateBridgeControl(tabId);
    return true;
  }

  const discoveries = discoveriesByTab.get(tabId);
  if (!discoveries?.length) {
    return false;
  }

  const providerSpecs = discoveries.map(({ transport, endpoint }) => ({ transport, endpoint }));
  if (providerSpecs.some((provider) => provider.transport === "postmessage")) {
    port.postMessage({ type: "bridge-control", active: true });
  }

  await connectTab(tabId, port, providerSpecs);
  updateBridgeControl(tabId);
  return true;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "slop") return;

  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  ports.set(tabId, port);

  port.onMessage.addListener(async (msg: ContentMessage) => {
    switch (msg.type) {
      case "slop-discovered":
        registerDiscoveries(tabId, port, msg.providers);
        if (hasTabSession(tabId)) {
          if (msg.providers.some((provider) => provider.transport === "postmessage")) {
            port.postMessage({ type: "bridge-control", active: true });
          }
          await syncTabDiscoveries(tabId, msg.providers);
          updateBridgeControl(tabId);
        }
        break;

      case "slop-lost":
        disconnectTab(tabId);
        clearTabDiscoveries(tabId);
        break;

      case "user-message":
        if (await ensureChatSession(tabId, port)) {
          await handleUserMessage(tabId, msg.text);
        }
        break;

      case "get-status": {
        await ensureChatSession(tabId, port);
        const state = getTabState(tabId);
        port.postMessage({
          type: "connection-status",
          status: getTabConnectionStatus(tabId),
          providerName: state?.providerName,
        });
        break;
      }

      case "get-state": {
        if (await ensureChatSession(tabId, port)) {
          const tree = getTabMergedTree(tabId);
          if (tree) {
            const { formatTree, affordancesToTools } = await import("@slop-ai/consumer/browser");
            port.postMessage({
              type: "state-update",
              formattedTree: formatTree(tree),
              toolCount: affordancesToTools(tree).length,
            });
          }
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
        if (storage.profiles.some((profile) => profile.id === msg.profileId)) {
          storage.activeProfileId = msg.profileId;
          await saveStorage(storage);
          port.postMessage({
            type: "profiles",
            profiles: storage.profiles,
            activeProfileId: storage.activeProfileId,
          });
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

      case "set-model":
        await setActiveModel(msg.model);
        port.postMessage({ type: "models", models: [], activeModel: msg.model });
        break;

      case "slop-from-provider": {
        const relays = desktopRelaysByTab.get(tabId);
        if (relays?.size) {
          for (const providerKey of relays) {
            relayToDesktop(providerKey, msg.message);
          }
        }
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(tabId);
    disconnectTab(tabId);
    clearTabDiscoveries(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  disconnectTab(tabId);
  ports.delete(tabId);
  clearTabDiscoveries(tabId);
});

startBridgeClient();

onBridgeMessage((msg) => {
  if (!msg?.type || typeof msg.providerKey !== "string") return;

  const indexed = discoveryIndex.get(msg.providerKey);
  if (!indexed) return;

  const { tabId, discovery } = indexed;
  const port = ports.get(tabId);
  if (!port || discovery.transport !== "postmessage") return;

  if (msg.type === "relay-open") {
    const activeRelays = desktopRelaysByTab.get(tabId) ?? new Set<string>();
    activeRelays.add(msg.providerKey);
    desktopRelaysByTab.set(tabId, activeRelays);
    updateBridgeControl(tabId);
    return;
  }

  if (msg.type === "relay-close") {
    removeDesktopRelay(tabId, msg.providerKey);
    return;
  }

  if (msg.type === "slop-relay" && msg.message) {
    updateBridgeControl(tabId);
    port.postMessage({ type: "slop-to-provider", message: msg.message });
  }
});
