import type { SlopSettings } from "../shared/messages";
import { DEFAULT_SETTINGS } from "../shared/messages";

const providerEl = document.getElementById("provider") as HTMLSelectElement;
const endpointEl = document.getElementById("endpoint") as HTMLInputElement;
const apiKeyEl = document.getElementById("apiKey") as HTMLInputElement;
const apiKeyRow = document.getElementById("apiKeyRow")!;
const modelEl = document.getElementById("model") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;

// Load settings
chrome.storage.sync.get("settings", (result) => {
  const s: SlopSettings = result.settings ?? DEFAULT_SETTINGS;
  providerEl.value = s.llmProvider;
  endpointEl.value = s.endpoint;
  apiKeyEl.value = s.apiKey;
  modelEl.value = s.model;
  toggleApiKey();
});

providerEl.onchange = toggleApiKey;

function toggleApiKey() {
  apiKeyRow.classList.toggle("visible", providerEl.value === "openai");
  if (providerEl.value === "ollama") {
    endpointEl.placeholder = "http://localhost:11434";
  } else {
    endpointEl.placeholder = "https://api.openai.com";
  }
}

saveBtn.onclick = () => {
  const settings: SlopSettings = {
    llmProvider: providerEl.value as "ollama" | "openai",
    endpoint: endpointEl.value || DEFAULT_SETTINGS.endpoint,
    apiKey: apiKeyEl.value,
    model: modelEl.value || DEFAULT_SETTINGS.model,
  };

  chrome.storage.sync.set({ settings }, () => {
    statusEl.textContent = "Settings saved!";
    statusEl.className = "status";
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
  });
};
