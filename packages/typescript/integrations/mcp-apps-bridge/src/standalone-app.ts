import { App } from "@modelcontextprotocol/ext-apps";

type ToolContent = { type: string; text?: string };

interface ProviderSummary {
  id: string;
  name: string;
  transport: string;
  source: string;
  connected: boolean;
  status?: string;
}

interface ActionSummary {
  name: string;
  description: string;
  path: string | null;
  action: string;
  targets?: string[];
  parameters: Record<string, unknown>;
}

interface SelectedProviderState {
  id: string;
  name: string;
  tree: unknown;
  formatted: string;
  actions: ActionSummary[];
}

interface StatePayload {
  updatedAt: number;
  providers: ProviderSummary[];
  selected?: SelectedProviderState;
}

const app = new App({ name: "slop-mcp-apps-bridge", version: "0.1.0" }, {});
let selectedApp: string | null = null;
let connected = false;
let latestContext = "";
let pollTimer: number | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

function readJsonPayload(result: { structuredContent?: unknown; content?: ToolContent[] }): StatePayload {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as StatePayload;
  }
  const text = result.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text;
  if (!text) throw new Error("Server returned no state payload.");
  return JSON.parse(text) as StatePayload;
}

async function fetchState(appId: string | null): Promise<StatePayload> {
  const result = await app.callServerTool({
    name: "slop_get_state",
    arguments: appId ? { app: appId } : {},
  });
  return readJsonPayload(result);
}

async function updateModelContext(payload: StatePayload): Promise<void> {
  if (!payload.selected) return;
  const actions = payload.selected.actions
    .map((action) => {
      const location = action.path
        ? ` on ${action.path}`
        : action.targets
          ? ` on ${action.targets.length} targets`
          : "";
      return `- ${action.action}${location}: ${action.description}`;
    })
    .join("\n");
  const context =
    `# ${payload.selected.name}\n\n` +
    `Connected SLOP app id: ${payload.selected.id}\n\n` +
    `## State\n\n\`\`\`\n${payload.selected.formatted}\n\`\`\`\n\n` +
    `## Actions\n\n${actions || "(none)"}`;

  if (context === latestContext) return;
  latestContext = context;

  try {
    await app.updateModelContext({ content: [{ type: "text", text: context }] });
  } catch {
    // Some hosts render MCP Apps but do not yet accept context updates.
  }
}

function renderShell(): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.4;
      }
      body {
        margin: 0;
        background: Canvas;
        color: CanvasText;
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: minmax(190px, 260px) minmax(0, 1fr);
        border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
      }
      .sidebar {
        border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        padding: 14px;
        overflow: auto;
      }
      .main {
        padding: 14px;
        min-width: 0;
        overflow: auto;
      }
      h1, h2 {
        margin: 0;
        letter-spacing: 0;
      }
      h1 {
        font-size: 16px;
        line-height: 1.2;
      }
      h2 {
        font-size: 13px;
        margin-top: 18px;
        margin-bottom: 8px;
      }
      .status {
        color: color-mix(in srgb, CanvasText 62%, transparent);
        font-size: 12px;
        margin-top: 4px;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }
      button {
        border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, Canvas 88%, CanvasText 12%);
        color: CanvasText;
        padding: 6px 9px;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: color-mix(in srgb, Canvas 80%, CanvasText 20%);
      }
      .provider {
        width: 100%;
        text-align: left;
        margin: 4px 0;
        display: grid;
        gap: 2px;
      }
      .provider[data-selected="true"] {
        border-color: color-mix(in srgb, Highlight 70%, CanvasText 15%);
        outline: 2px solid color-mix(in srgb, Highlight 24%, transparent);
      }
      .name {
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .meta, .empty {
        color: color-mix(in srgb, CanvasText 62%, transparent);
        font-size: 12px;
      }
      .state {
        margin: 0;
        padding: 12px;
        border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        border-radius: 6px;
        overflow: auto;
        white-space: pre-wrap;
        background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .actions {
        display: grid;
        gap: 6px;
      }
      .action {
        border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        border-radius: 6px;
        padding: 8px;
      }
      .action code {
        font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      @media (max-width: 680px) {
        .shell {
          grid-template-columns: 1fr;
        }
        .sidebar {
          border-right: 0;
          border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        }
      }
    </style>
    <div class="shell">
      <aside class="sidebar">
        <h1>SLOP Apps</h1>
        <div class="status" id="status">Connecting...</div>
        <div class="toolbar">
          <button id="refresh" type="button">Refresh</button>
        </div>
        <h2>Providers</h2>
        <div id="providers"></div>
      </aside>
      <main class="main">
        <div id="details">
          <p class="empty">Select a provider or ask the model to call <code>open_app</code>.</p>
        </div>
      </main>
    </div>`;

  document.getElementById("refresh")?.addEventListener("click", () => {
    void refresh();
  });
}

function renderProviders(payload: StatePayload): void {
  const target = document.getElementById("providers");
  if (!target) return;
  if (payload.providers.length === 0) {
    target.innerHTML = `<p class="empty">No SLOP providers found.</p>`;
    return;
  }

  target.innerHTML = payload.providers
    .map((provider) => {
      const selected = selectedApp === provider.id || payload.selected?.id === provider.id;
      const status = provider.connected ? (provider.status ?? "connected") : "available";
      return `
        <button class="provider" type="button" data-app="${escapeHtml(provider.id)}" data-selected="${selected ? "true" : "false"}">
          <span class="name">${escapeHtml(provider.name)}</span>
          <span class="meta">${escapeHtml(provider.id)} · ${escapeHtml(provider.transport)} · ${escapeHtml(status)}</span>
        </button>`;
    })
    .join("");

  target.querySelectorAll<HTMLButtonElement>("[data-app]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedApp = button.dataset.app ?? null;
      void refresh();
    });
  });
}

function renderDetails(payload: StatePayload): void {
  const details = document.getElementById("details");
  if (!details) return;
  if (!payload.selected) {
    details.innerHTML = `<p class="empty">No provider selected.</p>`;
    return;
  }

  const actions = payload.selected.actions
    .map((action) => {
      const location = action.path ?? (action.targets ? `${action.targets.length} targets` : "dynamic target");
      return `
        <div class="action">
          <div><code>${escapeHtml(action.action)}</code> <span class="meta">${escapeHtml(location)}</span></div>
          <div class="meta">${escapeHtml(action.description)}</div>
        </div>`;
    })
    .join("");

  details.innerHTML = `
    <h1>${escapeHtml(payload.selected.name)}</h1>
    <div class="status">id: ${escapeHtml(payload.selected.id)}</div>
    <h2>State</h2>
    <pre class="state">${escapeHtml(payload.selected.formatted)}</pre>
    <h2>Actions</h2>
    <div class="actions">${actions || `<p class="empty">No affordances exposed.</p>`}</div>`;
}

async function refresh(): Promise<void> {
  const status = document.getElementById("status");
  try {
    if (status) status.textContent = "Refreshing...";
    const payload = await fetchState(selectedApp);
    if (!selectedApp && payload.selected?.id) selectedApp = payload.selected.id;
    renderProviders(payload);
    renderDetails(payload);
    await updateModelContext(payload);
    if (status) {
      const time = new Date(payload.updatedAt).toLocaleTimeString();
      status.textContent = `Updated ${time}`;
    }
  } catch (error) {
    if (status) status.textContent = "Error";
    const details = document.getElementById("details");
    if (details) {
      details.innerHTML = `<p class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
  }
}

app.addEventListener("toolinput", (params) => {
  const appArg = params.arguments?.app;
  if (typeof appArg === "string" && appArg.length > 0) {
    selectedApp = appArg;
  }
  if (connected) void refresh();
});

renderShell();

try {
  await app.connect();
  connected = true;
  await refresh();
  pollTimer = window.setInterval(() => {
    void refresh();
  }, 2000);
} catch (error) {
  const status = document.getElementById("status");
  if (status) status.textContent = "Connection failed";
  const details = document.getElementById("details");
  if (details) {
    details.innerHTML = `<p class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

window.addEventListener("beforeunload", () => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  void app.close().catch(() => {});
});
