import chatCssText from "./chat.css" with { type: "text" };
import type { LlmProfile } from "../types";

interface ChatCallbacks {
  onSendMessage: (text: string) => void;
  onSwitchProfile: (profileId: string) => void;
  onSelectModel: (model: string) => void;
}

interface ChatUI {
  setStatus: (status: "disconnected" | "connecting" | "connected", providerName?: string) => void;
  setTree: (formattedTree: string, toolCount: number) => void;
  addMessage: (role: "user" | "assistant" | "tool-progress", content: string) => void;
  setInputEnabled: (enabled: boolean) => void;
  setProfiles: (profiles: LlmProfile[], activeId: string) => void;
  setModels: (models: string[], activeModel: string) => void;
  destroy: () => void;
}

export function createChatUI(callbacks: ChatCallbacks): ChatUI {
  const host = document.createElement("div");
  host.id = "slop-extension-root";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = chatCssText;
  shadow.appendChild(style);

  let panelOpen = false;
  let treeVisible = false;

  // FAB
  const fab = document.createElement("div");
  fab.className = "slop-fab";
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="#58a6ff" stroke="#58a6ff"/>
    </svg>
    <span class="status-dot disconnected"></span>
  `;
  fab.onclick = () => {
    panelOpen = !panelOpen;
    panel.classList.toggle("hidden", !panelOpen);
  };
  shadow.appendChild(fab);

  // Panel
  const panel = document.createElement("div");
  panel.className = "slop-panel hidden";

  const header = document.createElement("div");
  header.className = "slop-header";
  header.innerHTML = `
    <span class="title">SLOP</span>
    <span class="badge disconnected" id="slop-badge">Disconnected</span>
    <button id="slop-tree-toggle" title="Toggle state tree">{ }</button>
    <button id="slop-close" title="Close">&times;</button>
  `;
  panel.appendChild(header);

  const modelBar = document.createElement("div");
  modelBar.className = "slop-model-bar";
  modelBar.innerHTML = `
    <select id="slop-profile-select" class="profile-select" title="Connection"></select>
    <select id="slop-model-select" class="model-select" title="Model">
      <option value="">Loading models...</option>
    </select>
  `;
  panel.appendChild(modelBar);

  const treeDrawer = document.createElement("div");
  treeDrawer.className = "slop-tree-drawer hidden";
  treeDrawer.textContent = "No state available";
  panel.appendChild(treeDrawer);

  const messages = document.createElement("div");
  messages.className = "slop-messages";
  panel.appendChild(messages);

  const inputArea = document.createElement("div");
  inputArea.className = "slop-input";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ask about the app...";
  input.disabled = true;
  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  sendBtn.disabled = true;
  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);
  panel.appendChild(inputArea);

  shadow.appendChild(panel);

  // Event wiring
  const closeBtn = shadow.getElementById("slop-close")!;
  closeBtn.onclick = () => { panelOpen = false; panel.classList.add("hidden"); };

  const profileSelect = shadow.getElementById("slop-profile-select") as HTMLSelectElement;
  profileSelect.onchange = () => callbacks.onSwitchProfile(profileSelect.value);

  const modelSelect = shadow.getElementById("slop-model-select") as HTMLSelectElement;
  modelSelect.onchange = () => callbacks.onSelectModel(modelSelect.value);

  const treeToggle = shadow.getElementById("slop-tree-toggle")!;
  treeToggle.onclick = () => {
    treeVisible = !treeVisible;
    treeDrawer.classList.toggle("hidden", !treeVisible);
  };

  function doSend() {
    const text = input.value.trim();
    if (!text) return;
    addMsg("user", text);
    callbacks.onSendMessage(text);
    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;
  }

  sendBtn.onclick = doSend;
  input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };

  document.body.appendChild(host);

  // Internal helpers
  const statusDot = fab.querySelector(".status-dot")!;
  const badge = shadow.getElementById("slop-badge")!;
  const titleEl = header.querySelector(".title")!;

  function addMsg(role: string, content: string) {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.textContent = content;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  return {
    setStatus(status, providerName) {
      statusDot.className = `status-dot ${status}`;
      badge.className = `badge ${status}`;
      badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      if (providerName) titleEl.textContent = providerName;
      input.disabled = status !== "connected";
      sendBtn.disabled = status !== "connected";
    },

    setTree(formattedTree, toolCount) {
      treeDrawer.textContent = formattedTree + `\n\n(${toolCount} affordances available)`;
    },

    addMessage(role, content) {
      addMsg(role, content);
    },

    setInputEnabled(enabled) {
      input.disabled = !enabled;
      sendBtn.disabled = !enabled;
      if (enabled) input.focus();
    },

    setProfiles(profiles, activeId) {
      profileSelect.innerHTML = "";
      for (const p of profiles) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        opt.selected = p.id === activeId;
        profileSelect.appendChild(opt);
      }
    },

    setModels(models, activeModel) {
      if (models.length === 0 && activeModel) {
        modelSelect.value = activeModel;
        return;
      }
      modelSelect.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        opt.selected = m === activeModel;
        modelSelect.appendChild(opt);
      }
      if (activeModel && !models.includes(activeModel)) {
        const opt = document.createElement("option");
        opt.value = activeModel;
        opt.textContent = activeModel;
        opt.selected = true;
        modelSelect.prepend(opt);
      }
    },

    destroy() {
      host.remove();
    },
  };
}
