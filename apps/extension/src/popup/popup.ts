import type { PopupCommandMessage, PopupResponse } from "../types";
import { getPrefs, savePrefs } from "../types";

const activeToggle = document.getElementById("activeToggle") as HTMLInputElement;
const chatToggle = document.getElementById("chatToggle") as HTMLInputElement;
const bridgeToggle = document.getElementById("bridgeToggle") as HTMLInputElement;
const subToggles = document.getElementById("subToggles")!;
const settingsLink = document.getElementById("settingsLink") as HTMLAnchorElement;
const scanSection = document.getElementById("scanSection")!;
const scanStatus = document.getElementById("scanStatus")!;
const scanBtn = document.getElementById("scanBtn") as HTMLButtonElement;

let isScanning = false;

// Load prefs + check scan status
getPrefs().then(prefs => {
  activeToggle.checked = prefs.active;
  chatToggle.checked = prefs.chatUIEnabled;
  bridgeToggle.checked = prefs.bridgeEnabled;
  updateSubToggles(prefs.active);
  if (prefs.active) checkScanStatus();
});

function updateSubToggles(active: boolean) {
  subToggles.classList.toggle("disabled", !active);
  if (!active) scanSection.style.display = "none";
}

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
  if (prefs.active) checkScanStatus();
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
};

settingsLink.onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};
