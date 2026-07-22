import type {
  BackgroundCommandMessage,
  BridgeStatus,
  PopupCommandMessage,
  PopupResponse,
  TabProviderSummary,
} from "../types";
import { getPrefs, savePrefs } from "../types";

const activeToggle = document.getElementById("activeToggle") as HTMLInputElement;
const chatToggle = document.getElementById("chatToggle") as HTMLInputElement;
const bridgeToggle = document.getElementById("bridgeToggle") as HTMLInputElement;
const subToggles = document.getElementById("subToggles")!;
const settingsLink = document.getElementById("settingsLink") as HTMLAnchorElement;
const scanSection = document.getElementById("scanSection")!;
const scanStatus = document.getElementById("scanStatus")!;
const scanBtn = document.getElementById("scanBtn") as HTMLButtonElement;
const providersSection = document.getElementById("providersSection")!;
const providerList = document.getElementById("providerList")!;
const bridgeSection = document.getElementById("bridgeSection")!;
const bridgeStatus = document.getElementById("bridgeStatus")!;
const pairRow = document.getElementById("pairRow")!;
const pairToken = document.getElementById("pairToken") as HTMLInputElement;
const pairBtn = document.getElementById("pairBtn") as HTMLButtonElement;
const pairHint = document.getElementById("pairHint")!;

let isScanning = false;

function sendCommand<T>(message: BackgroundCommandMessage): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(response as T);
    });
  });
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// Load prefs + check scan status
getPrefs().then((prefs) => {
  activeToggle.checked = prefs.active;
  chatToggle.checked = prefs.chatUIEnabled;
  bridgeToggle.checked = prefs.bridgeEnabled;
  updateSubToggles(prefs.active);
  if (prefs.active) {
    checkScanStatus();
    renderProviders();
  }
  renderBridgeStatus();
});

function updateSubToggles(active: boolean) {
  subToggles.classList.toggle("disabled", !active);
  if (!active) {
    scanSection.style.display = "none";
    providersSection.style.display = "none";
  }
}

// --- Providers (origin binding + hello attribution) ---

async function renderProviders() {
  const tabId = await activeTabId();
  if (tabId == null) return;

  const response = await sendCommand<{ providers: TabProviderSummary[] }>({ type: "get-tab-providers", tabId });
  const providers = response?.providers ?? [];

  if (providers.length === 0) {
    providersSection.style.display = "none";
    return;
  }

  providersSection.style.display = "block";
  providerList.replaceChildren();

  for (const p of providers) {
    const item = document.createElement("div");
    item.className = "provider-item";

    const name = document.createElement("div");
    name.className = "provider-name";
    const dot = document.createElement("span");
    dot.className = `dot ${statusDotClass(p)}`;
    name.appendChild(dot);
    // Display name comes from the provider's hello identity, never the tab title.
    name.appendChild(document.createTextNode(p.name));
    item.appendChild(name);

    const sub = document.createElement("div");
    sub.className = "provider-sub";
    sub.textContent = p.fromHello && p.tabTitle ? `from tab: ${p.tabTitle}` : (p.endpoint ?? p.transport);
    item.appendChild(sub);

    if (p.status === "pending-approval") {
      const warn = document.createElement("div");
      warn.className = "provider-warn";
      warn.textContent = "Cross-origin target — this page points at a provider on another host.";
      item.appendChild(warn);

      const btn = document.createElement("button");
      btn.className = "connect-btn";
      btn.textContent = "Connect anyway";
      btn.onclick = async () => {
        btn.disabled = true;
        await sendCommand<{ ok: boolean }>({ type: "approve-provider", tabId, providerKey: p.providerKey });
        setTimeout(renderProviders, 400);
      };
      item.appendChild(btn);
    }

    providerList.appendChild(item);
  }
}

function statusDotClass(p: TabProviderSummary): string {
  if (p.status === "pending-approval") return "yellow";
  if (p.status === "connected") return "green";
  if (p.status === "connecting") return "yellow";
  return "gray";
}

// --- Desktop bridge pairing ---

async function renderBridgeStatus() {
  const prefs = await getPrefs();
  if (!prefs.active || !prefs.bridgeEnabled) {
    bridgeSection.style.display = "none";
    return;
  }

  bridgeSection.style.display = "block";
  const response = await sendCommand<{ bridgeStatus: BridgeStatus }>({ type: "get-bridge-status" });
  const status = response?.bridgeStatus ?? "disabled";

  const render = (dotClass: string, text: string, showPair: boolean) => {
    bridgeStatus.replaceChildren();
    const dot = document.createElement("span");
    dot.className = `dot ${dotClass}`;
    bridgeStatus.appendChild(dot);
    bridgeStatus.appendChild(document.createTextNode(text));
    pairRow.style.display = showPair ? "flex" : "none";
    pairHint.style.display = showPair ? "block" : "none";
  };

  switch (status) {
    case "unpaired":
      render("gray", "Pair with desktop", true);
      break;
    case "auth-failed":
      render("red", "Pairing rejected — re-pair", true);
      break;
    case "connected":
      render("green", "Desktop paired", false);
      break;
    case "connecting":
      render("yellow", "Connecting…", false);
      break;
    case "retrying":
      render("yellow", "Waiting for desktop…", false);
      break;
    default:
      render("gray", "Bridge off", false);
  }
}

pairBtn.onclick = async () => {
  const token = pairToken.value.trim();
  if (!token) return;
  pairBtn.disabled = true;
  await sendCommand<{ ok: boolean }>({ type: "set-bridge-token", token });
  pairToken.value = "";
  pairBtn.disabled = false;
  // Give the bridge client a moment to attempt the authenticated connect.
  setTimeout(renderBridgeStatus, 800);
};

async function checkScanStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "get-scan-status" } satisfies PopupCommandMessage, (response) => {
    const typedResponse = response as PopupResponse | undefined;
    if (chrome.runtime.lastError || !response) {
      // Content script not ready or no response
      scanSection.style.display = "block";
      showScanAvailable();
      return;
    }

    if (typedResponse && "hasSlop" in typedResponse && typedResponse.hasSlop) {
      // SLOP-native app — show connected status, no scan button
      scanSection.style.display = "block";
      scanStatus.innerHTML = '<span class="dot green"></span>SLOP provider detected';
      scanBtn.style.display = "none";
    } else if (typedResponse && "scanning" in typedResponse && typedResponse.scanning) {
      // Already scanning
      showScanning();
    } else {
      // No SLOP, not scanning — show scan button
      showScanAvailable();
    }
  });
}

function showScanAvailable() {
  isScanning = false;
  scanSection.style.display = "block";
  scanStatus.innerHTML = '<span class="dot gray"></span>No SLOP provider detected';
  scanBtn.textContent = "Scan this page";
  scanBtn.className = "scan-btn start";
  scanBtn.style.display = "block";
}

function showScanning() {
  isScanning = true;
  scanSection.style.display = "block";
  scanStatus.innerHTML = '<span class="dot yellow"></span>Accessibility adapter active';
  scanBtn.textContent = "Stop scanning";
  scanBtn.className = "scan-btn stop";
  scanBtn.style.display = "block";
}

scanBtn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (isScanning) {
    chrome.tabs.sendMessage(tab.id, { type: "stop-scan" } satisfies PopupCommandMessage, () => {
      showScanAvailable();
    });
  } else {
    chrome.tabs.sendMessage(tab.id, { type: "scan-page" } satisfies PopupCommandMessage, () => {
      showScanning();
    });
  }
};

activeToggle.onchange = async () => {
  const prefs = await getPrefs();
  prefs.active = activeToggle.checked;
  await savePrefs(prefs);
  updateSubToggles(prefs.active);
  if (prefs.active) {
    checkScanStatus();
    renderProviders();
  }
  renderBridgeStatus();
};

chatToggle.onchange = async () => {
  const prefs = await getPrefs();
  prefs.chatUIEnabled = chatToggle.checked;
  await savePrefs(prefs);
};

bridgeToggle.onchange = async () => {
  const prefs = await getPrefs();
  prefs.bridgeEnabled = bridgeToggle.checked;
  await savePrefs(prefs);
  // Bridge client reacts to the prefs change; reflect its new state shortly after.
  setTimeout(renderBridgeStatus, 300);
};

settingsLink.onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};
