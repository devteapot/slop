(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: (newValue) => all[name] = () => newValue
      });
  };

  // src/shared/tools.ts
  var exports_tools = {};
  __export(exports_tools, {
    formatTree: () => formatTree,
    encodeTool: () => encodeTool,
    decodeTool: () => decodeTool,
    affordancesToTools: () => affordancesToTools
  });
  function affordancesToTools(node, path = "") {
    const tools = [];
    for (const aff of node.affordances ?? []) {
      const toolName = encodeTool(path || "/", aff.action);
      tools.push({
        type: "function",
        function: {
          name: toolName,
          description: `${aff.label ?? aff.action}${aff.description ? ": " + aff.description : ""}` + ` (on ${path || "/"})` + (aff.dangerous ? " [DANGEROUS - confirm first]" : ""),
          parameters: aff.params ? aff.params : { type: "object", properties: {} }
        }
      });
    }
    for (const child of node.children ?? []) {
      tools.push(...affordancesToTools(child, `${path}/${child.id}`));
    }
    return tools;
  }
  function encodeTool(path, action) {
    const segments = path.split("/").filter(Boolean);
    return ["invoke", ...segments, action].join("__");
  }
  function decodeTool(name) {
    const parts = name.split("__");
    const action = parts[parts.length - 1];
    const pathSegments = parts.slice(1, -1);
    return { path: pathSegments.length > 0 ? "/" + pathSegments.join("/") : "/", action };
  }
  function formatTree(node, indent = 0) {
    const pad = "  ".repeat(indent);
    const props = node.properties ?? {};
    const label = props.label ?? props.title ?? node.id;
    const extra = Object.entries(props).filter(([k]) => k !== "label" && k !== "title").map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
    const affordances = (node.affordances ?? []).map((a) => {
      let s = a.action;
      if (a.params?.properties) {
        const params = Object.entries(a.params.properties).map(([k, v]) => `${k}: ${v.type}`).join(", ");
        s += `(${params})`;
      }
      return s;
    }).join(", ");
    let line = `${pad}[${node.type}] ${label}`;
    if (extra)
      line += ` (${extra})`;
    if (affordances)
      line += `  actions: {${affordances}}`;
    const lines = [line];
    for (const child of node.children ?? []) {
      lines.push(formatTree(child, indent + 1));
    }
    return lines.join(`
`);
  }

  // src/shared/state-mirror.ts
  class StateMirror {
    tree;
    version;
    constructor(snapshot) {
      this.tree = structuredClone(snapshot.tree);
      this.version = snapshot.version;
    }
    applyPatch(patch) {
      for (const op of patch.ops) {
        this.applyOp(op);
      }
      this.version = patch.version;
    }
    getTree() {
      return this.tree;
    }
    getVersion() {
      return this.version;
    }
    applyOp(op) {
      const segments = op.path.split("/").filter(Boolean);
      if (segments.length === 0)
        return;
      switch (op.op) {
        case "add":
          this.applyAdd(segments, op.value);
          break;
        case "remove":
          this.applyRemove(segments);
          break;
        case "replace":
          this.applyReplace(segments, op.value);
          break;
      }
    }
    navigate(segments) {
      let current = this.tree;
      for (let i = 0;i < segments.length - 1; i++) {
        const seg = segments[i];
        if (seg === "children") {
          const childId = segments[i + 1];
          const child = current.children?.find((c) => c.id === childId);
          if (!child)
            return null;
          current = child;
          i++;
        } else if (seg === "properties" || seg === "meta" || seg === "affordances") {
          current = current[seg];
          if (current === undefined)
            return null;
        } else {
          current = current[seg];
          if (current === undefined)
            return null;
        }
      }
      return { parent: current, key: segments[segments.length - 1] };
    }
    applyAdd(segments, value) {
      if (segments.length >= 2 && segments[segments.length - 2] === "children") {
        const parent = this.resolveNode(segments.slice(0, -2));
        if (parent) {
          if (!parent.children)
            parent.children = [];
          parent.children.push(value);
        }
        return;
      }
      const target = this.navigate(segments);
      if (target)
        target.parent[target.key] = value;
    }
    applyRemove(segments) {
      if (segments.length >= 2 && segments[segments.length - 2] === "children") {
        const childId = segments[segments.length - 1];
        const parent = this.resolveNode(segments.slice(0, -2));
        if (parent?.children) {
          parent.children = parent.children.filter((c) => c.id !== childId);
        }
        return;
      }
      const target = this.navigate(segments);
      if (target)
        delete target.parent[target.key];
    }
    applyReplace(segments, value) {
      const target = this.navigate(segments);
      if (target)
        target.parent[target.key] = value;
    }
    resolveNode(segments) {
      if (segments.length === 0)
        return this.tree;
      let current = this.tree;
      for (let i = 0;i < segments.length; i++) {
        if (segments[i] === "children") {
          const child = current.children?.find((c) => c.id === segments[i + 1]);
          if (!child)
            return null;
          current = child;
          i++;
        }
      }
      return current;
    }
  }

  // src/shared/emitter.ts
  class Emitter {
    listeners = new Map;
    on(event, fn) {
      if (!this.listeners.has(event))
        this.listeners.set(event, new Set);
      this.listeners.get(event).add(fn);
    }
    off(event, fn) {
      this.listeners.get(event)?.delete(fn);
    }
    emit(event, ...args) {
      for (const fn of this.listeners.get(event) ?? [])
        fn(...args);
    }
  }

  // src/shared/consumer.ts
  class SlopConsumer extends Emitter {
    connection = null;
    mirrors = new Map;
    pending = new Map;
    transport;
    subCounter = 0;
    reqCounter = 0;
    constructor(transport) {
      super();
      this.transport = transport;
    }
    async connect() {
      this.connection = await this.transport.connect();
      return new Promise((resolve) => {
        this.connection.onMessage((msg) => {
          const m = msg;
          if (m.type === "hello") {
            resolve(m);
            this.connection.onMessage((msg2) => this.handleMessage(msg2));
          }
        });
        this.connection.onClose(() => this.emit("disconnect"));
      });
    }
    async subscribe(path = "/", depth = 1) {
      const id = `sub-${++this.subCounter}`;
      return new Promise((resolve) => {
        this.pending.set(id, {
          resolve: (snapshot) => resolve({ id, snapshot }),
          reject: () => {}
        });
        this.connection.send({ type: "subscribe", id, path, depth });
      });
    }
    unsubscribe(id) {
      this.mirrors.delete(id);
      this.connection?.send({ type: "unsubscribe", id });
    }
    async query(path = "/", depth = 1) {
      const id = `q-${++this.reqCounter}`;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.connection.send({ type: "query", id, path, depth });
      });
    }
    async invoke(path, action, params) {
      const id = `inv-${++this.reqCounter}`;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.connection.send({ type: "invoke", id, path, action, params });
      });
    }
    getTree(subscriptionId) {
      return this.mirrors.get(subscriptionId)?.getTree() ?? null;
    }
    disconnect() {
      this.connection?.close();
      this.connection = null;
    }
    handleMessage(msg) {
      switch (msg.type) {
        case "snapshot": {
          const mirror = new StateMirror(msg);
          this.mirrors.set(msg.id, mirror);
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve(msg.tree);
          }
          break;
        }
        case "patch": {
          const mirror = this.mirrors.get(msg.subscription);
          if (mirror) {
            mirror.applyPatch(msg);
            this.emit("patch", msg.subscription, msg.ops, msg.version);
          }
          break;
        }
        case "result": {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
          break;
        }
      }
    }
  }

  // src/shared/transport-ws.ts
  class WebSocketClientTransport {
    url;
    constructor(url) {
      this.url = url;
    }
    async connect() {
      const ws = new WebSocket(this.url);
      await new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error(`WebSocket connection failed: ${this.url}`));
      });
      const messageHandlers = [];
      const closeHandlers = [];
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          for (const h of messageHandlers)
            h(msg);
        } catch {}
      };
      ws.onclose = () => {
        for (const h of closeHandlers)
          h();
      };
      return {
        send(msg) {
          ws.send(JSON.stringify(msg));
        },
        onMessage(h) {
          messageHandlers.push(h);
        },
        onClose(h) {
          closeHandlers.push(h);
        },
        close() {
          ws.close();
        }
      };
    }
  }

  // src/shared/transport-pm.ts
  class PostMessageClientTransport {
    port;
    constructor(port) {
      this.port = port;
    }
    async connect() {
      const messageHandlers = [];
      const closeHandlers = [];
      this.port.onMessage.addListener((msg) => {
        if (msg.type === "slop-from-provider") {
          for (const h of messageHandlers)
            h(msg.message);
        }
      });
      this.port.onDisconnect.addListener(() => {
        for (const h of closeHandlers)
          h();
      });
      this.port.postMessage({
        type: "slop-to-provider",
        message: { type: "connect" }
      });
      return {
        send: (m) => {
          this.port.postMessage({ type: "slop-to-provider", message: m });
        },
        onMessage: (h) => {
          messageHandlers.push(h);
        },
        onClose: (h) => {
          closeHandlers.push(h);
        },
        close: () => {}
      };
    }
  }
  // src/background/llm.ts
  async function getSettings() {
    const result = await chrome.storage.sync.get("settings");
    return result.settings ?? {
      llmProvider: "ollama",
      endpoint: "http://localhost:11434",
      apiKey: "",
      model: "qwen2.5:14b"
    };
  }
  async function chatCompletion(messages, tools) {
    const settings = await getSettings();
    const url = `${settings.endpoint}/v1/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) {
      headers["Authorization"] = `Bearer ${settings.apiKey}`;
    }
    const body = {
      model: settings.model,
      messages,
      stream: false
    };
    if (tools.length > 0)
      body.tools = tools;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices[0].message;
  }

  // src/background/slop-manager.ts
  var SYSTEM_PROMPT = `You are an AI assistant connected to a web application via the SLOP protocol (State Layer for Observable Programs).

You can SEE the application's current state as a structured tree, and you can ACT on it by calling the available tool functions.

Each tool represents an affordance (action) on a specific node in the state tree. Tool names encode the path: e.g. "invoke__todos__todo-1__toggle" means invoke the "toggle" action on the node at path "/todos/todo-1".

When the user asks you to do something, look at the current state, figure out which action(s) to invoke, and call the appropriate tool(s). After acting, describe what you did and the result.

IMPORTANT: You can and SHOULD call MULTIPLE tools in a single response when the user's request requires acting on multiple items.

You are running inside a browser extension chat panel. Keep responses concise.`;
  var tabs = new Map;
  function sendToPort(port, msg) {
    try {
      port.postMessage(msg);
    } catch {}
  }
  async function connectTab(tabId, port, transport, endpoint) {
    disconnectTab(tabId);
    sendToPort(port, { type: "connection-status", status: "connecting" });
    try {
      const clientTransport = transport === "ws" ? new WebSocketClientTransport(endpoint) : new PostMessageClientTransport(port);
      const consumer = new SlopConsumer(clientTransport);
      const hello = await consumer.connect();
      const { id: subId, snapshot } = await consumer.subscribe("/", -1);
      const existingConversation = tabs.get(tabId)?.conversation;
      const state = {
        consumer,
        subscriptionId: subId,
        currentTree: snapshot,
        port,
        conversation: existingConversation ?? [{ role: "system", content: SYSTEM_PROMPT }],
        providerName: hello.provider.name,
        processing: false,
        transport,
        endpoint,
        reconnecting: false
      };
      tabs.set(tabId, state);
      sendToPort(port, {
        type: "connection-status",
        status: "connected",
        providerName: hello.provider.name
      });
      pushStateUpdate(state);
      consumer.on("patch", () => {
        state.currentTree = consumer.getTree(subId);
        pushStateUpdate(state);
      });
      consumer.on("disconnect", () => {
        if (!state.reconnecting) {
          state.reconnecting = true;
          sendToPort(port, { type: "connection-status", status: "connecting" });
          setTimeout(() => {
            reconnectTab(tabId);
          }, 1000);
        }
      });
    } catch (err) {
      sendToPort(port, { type: "connection-status", status: "disconnected" });
      sendToPort(port, { type: "chat-error", message: `Connection failed: ${err.message}` });
    }
  }
  async function reconnectTab(tabId) {
    const state = tabs.get(tabId);
    if (!state)
      return;
    try {
      await connectTab(tabId, state.port, state.transport, state.endpoint);
    } catch {
      setTimeout(() => reconnectTab(tabId), 3000);
    }
  }
  function disconnectTab(tabId) {
    const state = tabs.get(tabId);
    if (state) {
      state.consumer.disconnect();
      tabs.delete(tabId);
    }
  }
  function pushStateUpdate(state) {
    if (!state.currentTree)
      return;
    sendToPort(state.port, {
      type: "state-update",
      formattedTree: formatTree(state.currentTree),
      toolCount: affordancesToTools(state.currentTree).length
    });
  }
  async function handleUserMessage(tabId, text) {
    const state = tabs.get(tabId);
    if (!state || !state.currentTree) {
      return;
    }
    if (state.processing)
      return;
    state.processing = true;
    try {
      const stateContext = `

[Current application state]
${formatTree(state.currentTree)}`;
      state.conversation.push({ role: "user", content: text + stateContext });
      let tools = affordancesToTools(state.currentTree);
      let response = await chatCompletion(state.conversation, tools);
      while (response.tool_calls && response.tool_calls.length > 0) {
        state.conversation.push(response);
        for (const tc of response.tool_calls) {
          const { path, action } = decodeTool(tc.function.name);
          const params = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          sendToPort(state.port, {
            type: "chat-message",
            role: "tool-progress",
            content: `Invoking ${action} on ${path}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`
          });
          const result = await state.consumer.invoke(path, action, params);
          await new Promise((r) => setTimeout(r, 100));
          const resultStr = result.status === "ok" ? `OK${result.data ? ": " + JSON.stringify(result.data) : ""}` : `Error [${result.error?.code}]: ${result.error?.message}`;
          state.conversation.push({
            role: "tool",
            content: resultStr + `

[Updated state]
` + formatTree(state.currentTree),
            tool_call_id: tc.id
          });
        }
        if (state.currentTree) {
          tools = affordancesToTools(state.currentTree);
        }
        response = await chatCompletion(state.conversation, tools);
      }
      state.conversation.push(response);
      sendToPort(state.port, { type: "chat-message", role: "assistant", content: response.content });
      sendToPort(state.port, { type: "chat-done" });
    } catch (err) {
      sendToPort(state.port, { type: "chat-error", message: err.message });
    } finally {
      state.processing = false;
    }
  }
  function getTabState(tabId) {
    return tabs.get(tabId);
  }

  // src/background/index.ts
  var ports = new Map;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "slop")
      return;
    const tabId = port.sender?.tab?.id;
    if (!tabId)
      return;
    ports.set(tabId, port);
    port.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case "slop-discovered":
          await connectTab(tabId, port, msg.transport, msg.endpoint);
          break;
        case "slop-lost":
          disconnectTab(tabId);
          break;
        case "user-message":
          await handleUserMessage(tabId, msg.text);
          break;
        case "get-status": {
          const state = getTabState(tabId);
          port.postMessage({
            type: "connection-status",
            status: state ? "connected" : "disconnected",
            providerName: state?.providerName
          });
          break;
        }
        case "get-state": {
          const state = getTabState(tabId);
          if (state?.currentTree) {
            const { formatTree: formatTree2, affordancesToTools: affordancesToTools2 } = await Promise.resolve().then(() => exports_tools);
            port.postMessage({
              type: "state-update",
              formattedTree: formatTree2(state.currentTree),
              toolCount: affordancesToTools2(state.currentTree).length
            });
          }
          break;
        }
        case "slop-from-provider":
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      ports.delete(tabId);
      disconnectTab(tabId);
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    disconnectTab(tabId);
    ports.delete(tabId);
  });
})();
