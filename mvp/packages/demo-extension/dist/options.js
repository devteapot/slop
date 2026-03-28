(() => {
  // src/shared/messages.ts
  var DEFAULT_SETTINGS = {
    llmProvider: "ollama",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "qwen2.5:14b"
  };

  // src/options/options.ts
  var providerEl = document.getElementById("provider");
  var endpointEl = document.getElementById("endpoint");
  var apiKeyEl = document.getElementById("apiKey");
  var apiKeyRow = document.getElementById("apiKeyRow");
  var modelEl = document.getElementById("model");
  var saveBtn = document.getElementById("save");
  var statusEl = document.getElementById("status");
  chrome.storage.sync.get("settings", (result) => {
    const s = result.settings ?? DEFAULT_SETTINGS;
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
    const settings = {
      llmProvider: providerEl.value,
      endpoint: endpointEl.value || DEFAULT_SETTINGS.endpoint,
      apiKey: apiKeyEl.value,
      model: modelEl.value || DEFAULT_SETTINGS.model
    };
    chrome.storage.sync.set({ settings }, () => {
      statusEl.textContent = "Settings saved!";
      statusEl.className = "status";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    });
  };
})();
