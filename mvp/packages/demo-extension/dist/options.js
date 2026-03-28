(() => {
  // src/shared/messages.ts
  var DEFAULT_PROFILE = {
    id: "default",
    name: "Ollama Local",
    llmProvider: "ollama",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "qwen2.5:14b"
  };
  var DEFAULT_STORAGE = {
    profiles: [DEFAULT_PROFILE],
    activeProfileId: "default"
  };

  // src/options/options.ts
  var profileListEl = document.getElementById("profileList");
  var addProfileBtn = document.getElementById("addProfile");
  var editForm = document.getElementById("editForm");
  var formTitle = document.getElementById("formTitle");
  var editIdEl = document.getElementById("editId");
  var profileNameEl = document.getElementById("profileName");
  var providerEl = document.getElementById("provider");
  var endpointEl = document.getElementById("endpoint");
  var apiKeyEl = document.getElementById("apiKey");
  var apiKeyRow = document.getElementById("apiKeyRow");
  var saveBtn = document.getElementById("saveProfile");
  var cancelBtn = document.getElementById("cancelEdit");
  var statusEl = document.getElementById("status");
  var storage = DEFAULT_STORAGE;
  async function loadStorage() {
    const result = await chrome.storage.sync.get("slopStorage");
    storage = result.slopStorage ?? DEFAULT_STORAGE;
    renderProfiles();
  }
  function renderProfiles() {
    profileListEl.innerHTML = "";
    for (const profile of storage.profiles) {
      const isActive = profile.id === storage.activeProfileId;
      const item = document.createElement("div");
      item.className = `profile-item${isActive ? " active" : ""}`;
      item.innerHTML = `
      <div class="info">
        <div class="name">${esc(profile.name)}${isActive ? " (active)" : ""}</div>
        <div class="detail">${esc(profile.model)} &middot; ${esc(profile.endpoint)}</div>
      </div>
      <div class="actions">
        ${!isActive ? `<button data-action="activate" data-id="${profile.id}">Use</button>` : ""}
        <button data-action="edit" data-id="${profile.id}">Edit</button>
        ${storage.profiles.length > 1 ? `<button data-action="delete" data-id="${profile.id}" class="danger">Del</button>` : ""}
      </div>
    `;
      profileListEl.appendChild(item);
    }
    profileListEl.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const el = e.target;
        const action = el.dataset.action;
        const id = el.dataset.id;
        if (action === "activate")
          activateProfile(id);
        if (action === "edit")
          openEditForm(id);
        if (action === "delete")
          deleteProfile(id);
      });
    });
  }
  function activateProfile(id) {
    storage.activeProfileId = id;
    save();
  }
  function deleteProfile(id) {
    storage.profiles = storage.profiles.filter((p) => p.id !== id);
    if (storage.activeProfileId === id && storage.profiles.length > 0) {
      storage.activeProfileId = storage.profiles[0].id;
    }
    save();
  }
  function openEditForm(id) {
    const profile = id ? storage.profiles.find((p) => p.id === id) : null;
    formTitle.textContent = profile ? "Edit Profile" : "New Profile";
    editIdEl.value = profile?.id ?? "";
    profileNameEl.value = profile?.name ?? "";
    providerEl.value = profile?.llmProvider ?? "ollama";
    endpointEl.value = profile?.endpoint ?? "";
    apiKeyEl.value = profile?.apiKey ?? "";
    toggleApiKey();
    editForm.classList.remove("hidden");
    profileNameEl.focus();
  }
  function closeEditForm() {
    editForm.classList.add("hidden");
  }
  function toggleApiKey() {
    apiKeyRow.classList.toggle("visible", providerEl.value !== "ollama");
    switch (providerEl.value) {
      case "ollama":
        endpointEl.placeholder = "http://localhost:11434";
        break;
      case "openai":
        endpointEl.placeholder = "https://api.openai.com";
        break;
      case "openrouter":
        endpointEl.placeholder = "https://openrouter.ai/api";
        break;
      case "gemini":
        endpointEl.placeholder = "https://generativelanguage.googleapis.com";
        break;
    }
  }
  function saveProfile() {
    const id = editIdEl.value || `profile-${Date.now()}`;
    const profile = {
      id,
      name: profileNameEl.value || `${providerEl.value} - ${modelEl.value}`,
      llmProvider: providerEl.value,
      endpoint: endpointEl.value || { ollama: "http://localhost:11434", openai: "https://api.openai.com", openrouter: "https://openrouter.ai/api", gemini: "https://generativelanguage.googleapis.com" }[providerEl.value] || "http://localhost:11434",
      apiKey: apiKeyEl.value,
      model: ""
    };
    const idx = storage.profiles.findIndex((p) => p.id === id);
    if (idx >= 0) {
      storage.profiles[idx] = profile;
    } else {
      storage.profiles.push(profile);
      storage.activeProfileId = profile.id;
    }
    save();
    closeEditForm();
  }
  function save() {
    chrome.storage.sync.set({ slopStorage: storage }, () => {
      renderProfiles();
      showStatus("Saved!");
    });
  }
  function showStatus(text) {
    statusEl.textContent = text;
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2000);
  }
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  providerEl.onchange = toggleApiKey;
  addProfileBtn.onclick = () => openEditForm();
  saveBtn.onclick = saveProfile;
  cancelBtn.onclick = closeEditForm;
  loadStorage();
})();
