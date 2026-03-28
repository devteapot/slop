(() => {
  // src/content/discovery.ts
  function discoverSlop() {
    const meta = document.querySelector('meta[name="slop"]');
    if (!meta)
      return null;
    const content = meta.getAttribute("content");
    if (!content)
      return null;
    if (content === "postmessage") {
      return { transport: "postmessage" };
    }
    if (content.startsWith("ws://") || content.startsWith("wss://")) {
      return { transport: "ws", endpoint: content };
    }
    return null;
  }
  function observeDiscovery(callback) {
    const observer = new MutationObserver(() => {
      const result = discoverSlop();
      if (result) {
        callback(result);
        observer.disconnect();
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });
  }

  // src/content/bridge.ts
  function startBridge(port) {
    window.addEventListener("message", (event) => {
      if (event.source !== window)
        return;
      if (event.data?.slop !== true)
        return;
      port.postMessage({ type: "slop-from-provider", message: event.data.message });
    });
    port.onMessage.addListener((msg) => {
      if (msg.type === "slop-to-provider") {
        window.postMessage({ slop: true, message: msg.message }, "*");
      }
    });
  }

  // src/ui/chat.css
  var chat_default = `:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: #e1e4e8;
}

.slop-fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #1c2028;
  border: 2px solid #30363d;
  cursor: pointer;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: border-color 0.2s, transform 0.2s;
}
.slop-fab:hover { border-color: #58a6ff; transform: scale(1.05); }
.slop-fab svg { width: 24px; height: 24px; }
.slop-fab .status-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #1c2028;
}
.status-dot.connected { background: #3fb950; }
.status-dot.connecting { background: #d29922; }
.status-dot.disconnected { background: #6e7681; }

.slop-panel {
  position: fixed;
  bottom: 82px;
  right: 20px;
  width: 400px;
  height: min(600px, calc(100vh - 100px));
  background: #0f1117;
  border: 1px solid #30363d;
  border-radius: 12px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  overflow: hidden;
}
.slop-panel.hidden { display: none; }

.slop-header {
  padding: 12px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  display: flex;
  align-items: center;
  gap: 8px;
}
.slop-header .title {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slop-header .badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 8px;
  font-weight: 500;
}
.badge.connected { background: #238636; color: #fff; }
.badge.connecting { background: #9e6a03; color: #fff; }
.badge.disconnected { background: #6e7681; color: #fff; }

.slop-header button {
  background: none;
  border: none;
  color: #8b949e;
  cursor: pointer;
  padding: 4px;
  font-size: 14px;
  border-radius: 4px;
}
.slop-header button:hover { color: #e1e4e8; background: #30363d; }

.slop-model-bar {
  display: flex;
  gap: 6px;
  padding: 6px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}

.profile-select, .model-select {
  background: #0d1117;
  border: 1px solid #30363d;
  color: #8b949e;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.profile-select { flex: 0 0 auto; max-width: 140px; }
.model-select { flex: 1; min-width: 0; }
.profile-select:focus, .model-select:focus { outline: none; border-color: #58a6ff; color: #e1e4e8; }

.slop-tree-drawer {
  max-height: 150px;
  overflow-y: auto;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  color: #8b949e;
  white-space: pre;
}
.slop-tree-drawer.hidden { display: none; }

.slop-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.4;
  word-wrap: break-word;
}
.msg.user {
  align-self: flex-end;
  background: #1f6feb;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg.assistant {
  align-self: flex-start;
  background: #1c2028;
  border: 1px solid #30363d;
  border-bottom-left-radius: 4px;
}
.msg.tool-progress {
  align-self: flex-start;
  background: transparent;
  color: #8b949e;
  font-size: 11px;
  font-family: monospace;
  padding: 4px 8px;
  border-left: 2px solid #3fb950;
}
.msg.error {
  align-self: flex-start;
  background: #3d1215;
  border: 1px solid #da3633;
  color: #f0a0a0;
}

.slop-input {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid #30363d;
  background: #161b22;
}
.slop-input input {
  flex: 1;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #e1e4e8;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.slop-input input:focus { border-color: #58a6ff; }
.slop-input input:disabled { opacity: 0.5; }
.slop-input button {
  background: #238636;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.slop-input button:hover { background: #2ea043; }
.slop-input button:disabled { opacity: 0.5; cursor: default; }
`;

  // src/ui/chat.ts
  function createChatUI(callbacks) {
    const host = document.createElement("div");
    host.id = "slop-extension-root";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = chat_default;
    shadow.appendChild(style);
    let panelOpen = false;
    let treeVisible = false;
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
    const closeBtn = shadow.getElementById("slop-close");
    closeBtn.onclick = () => {
      panelOpen = false;
      panel.classList.add("hidden");
    };
    const profileSelect = shadow.getElementById("slop-profile-select");
    profileSelect.onchange = () => {
      callbacks.onSwitchProfile(profileSelect.value);
    };
    const modelSelect = shadow.getElementById("slop-model-select");
    modelSelect.onchange = () => {
      callbacks.onSelectModel(modelSelect.value);
    };
    callbacks.onRequestProfiles();
    callbacks.onFetchModels();
    const treeToggle = shadow.getElementById("slop-tree-toggle");
    treeToggle.onclick = () => {
      treeVisible = !treeVisible;
      treeDrawer.classList.toggle("hidden", !treeVisible);
      if (treeVisible)
        callbacks.onRequestState();
    };
    function doSend() {
      const text = input.value.trim();
      if (!text)
        return;
      addMsg("user", text);
      callbacks.onSendMessage(text);
      input.value = "";
      input.disabled = true;
      sendBtn.disabled = true;
    }
    sendBtn.onclick = doSend;
    input.onkeydown = (e) => {
      if (e.key === "Enter")
        doSend();
    };
    document.body.appendChild(host);
    const statusDot = fab.querySelector(".status-dot");
    const badge = shadow.getElementById("slop-badge");
    const titleEl = header.querySelector(".title");
    function addMsg(role, content) {
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
        if (providerName)
          titleEl.textContent = providerName;
        input.disabled = status !== "connected";
        sendBtn.disabled = status !== "connected";
      },
      setTree(formattedTree, toolCount) {
        treeDrawer.textContent = formattedTree + `

(${toolCount} affordances available)`;
      },
      addMessage(role, content) {
        addMsg(role, content);
      },
      setInputEnabled(enabled) {
        input.disabled = !enabled;
        sendBtn.disabled = !enabled;
        if (enabled)
          input.focus();
      },
      setProfiles(profiles, activeProfileId) {
        profileSelect.innerHTML = "";
        for (const p of profiles) {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name;
          opt.selected = p.id === activeProfileId;
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
      }
    };
  }

  // src/content/index.ts
  var port = null;
  var chatUI = null;
  function init() {
    const discovery = discoverSlop();
    if (discovery) {
      setup(discovery);
    } else {
      observeDiscovery((d) => setup(d));
    }
  }
  function setup(discovery) {
    port = chrome.runtime.connect({ name: "slop" });
    if (discovery.transport === "postmessage") {
      startBridge(port);
    }
    chatUI = createChatUI({
      onSendMessage: (text) => {
        port?.postMessage({ type: "user-message", text });
      },
      onRequestState: () => {
        port?.postMessage({ type: "get-state" });
      },
      onSwitchProfile: (profileId) => {
        port?.postMessage({ type: "set-active-profile", profileId });
      },
      onRequestProfiles: () => {
        port?.postMessage({ type: "get-profiles" });
      },
      onFetchModels: () => {
        port?.postMessage({ type: "fetch-models" });
      },
      onSelectModel: (model) => {
        port?.postMessage({ type: "set-model", model });
      }
    });
    port.onMessage.addListener((msg) => {
      if (!chatUI)
        return;
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
    });
    port.onDisconnect.addListener(() => {
      chatUI?.setStatus("disconnected");
    });
    port.postMessage({
      type: "slop-discovered",
      transport: discovery.transport,
      endpoint: discovery.endpoint
    });
  }
  init();
})();
