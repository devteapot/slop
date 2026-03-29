import { getPrefs, savePrefs } from "../shared/messages";

const activeToggle = document.getElementById("activeToggle") as HTMLInputElement;
const chatToggle = document.getElementById("chatToggle") as HTMLInputElement;
const bridgeToggle = document.getElementById("bridgeToggle") as HTMLInputElement;
const subToggles = document.getElementById("subToggles")!;
const settingsLink = document.getElementById("settingsLink") as HTMLAnchorElement;

// Load current prefs
getPrefs().then(prefs => {
  activeToggle.checked = prefs.active;
  chatToggle.checked = prefs.chatUIEnabled;
  bridgeToggle.checked = prefs.bridgeEnabled;
  updateSubToggles(prefs.active);
});

function updateSubToggles(active: boolean) {
  subToggles.classList.toggle("disabled", !active);
}

activeToggle.onchange = async () => {
  const prefs = await getPrefs();
  prefs.active = activeToggle.checked;
  await savePrefs(prefs);
  updateSubToggles(prefs.active);
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
