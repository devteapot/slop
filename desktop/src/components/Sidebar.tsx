import { useState, useMemo } from "react";
import { useAppStore } from "../stores/app-store";
import type { ProviderSummary } from "../lib/types";

function transportLabel(p: ProviderSummary): string {
  switch (p.transport_type) {
    case "unix": return "sock";
    case "relay": return "pm";
    default: return "ws";
  }
}

export function Sidebar() {
  const providers = useAppStore(s => s.providers);
  const connectProvider = useAppStore(s => s.connectProvider);
  const disconnectProvider = useAppStore(s => s.disconnectProvider);
  const addManualProvider = useAppStore(s => s.addManualProvider);
  const removeProvider = useAppStore(s => s.removeProvider);

  const [url, setUrl] = useState("");
  const [browserCollapsed, setBrowserCollapsed] = useState(true);

  const localEntries = useMemo(
    () => providers.filter(p => p.source === "discovered"),
    [providers],
  );
  const browserEntries = useMemo(
    () => providers.filter(p => p.source === "bridge"),
    [providers],
  );
  const manualEntries = useMemo(
    () => providers.filter(p => p.source === "manual"),
    [providers],
  );

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    addManualProvider(url.trim());
    setUrl("");
  }

  function handleClick(p: ProviderSummary) {
    if (p.status === "connected") {
      disconnectProvider(p.id);
    } else {
      connectProvider(p.id);
    }
  }

  function handleRemove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    removeProvider(id);
  }

  function renderItem(p: ProviderSummary) {
    return (
      <div
        key={p.id}
        className={`provider-item${p.status === "connected" ? " active" : ""}`}
        onClick={() => handleClick(p)}
      >
        <span className={`status-dot ${p.status}`} />
        <span className="name" title={p.id}>
          {p.provider_name ?? p.name}
        </span>
        <span className="transport-badge">{transportLabel(p)}</span>

        <span className="provider-actions">
          {p.status === "connected" && (
            <button
              className="remove-btn"
              title="Disconnect"
              onClick={(e) => { e.stopPropagation(); disconnectProvider(p.id); }}
            >
              &#x23FB;
            </button>
          )}
          {p.source === "manual" && p.status === "disconnected" && (
            <button
              className="remove-btn"
              title="Remove"
              onClick={(e) => handleRemove(e, p.id)}
            >
              &times;
            </button>
          )}
        </span>
      </div>
    );
  }

  const showEmpty = providers.length === 0;

  return (
    <div className="sidebar">
      <div className="sidebar-header">Providers</div>

      <div className="provider-list">
        {showEmpty && (
          <div style={{ padding: "16px", color: "#6e7681", fontSize: "12px", textAlign: "center" }}>
            No providers yet. Add a WebSocket URL or socket path below.
          </div>
        )}

        {localEntries.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-header">Local Apps</div>
            <div className="sidebar-group-content">
              {localEntries.map(renderItem)}
            </div>
          </div>
        )}

        {browserEntries.length > 0 && (
          <div className={`sidebar-group${browserCollapsed ? " collapsed" : ""}`}>
            <div
              className="sidebar-group-header"
              onClick={() => setBrowserCollapsed(c => !c)}
              style={{ cursor: "pointer" }}
            >
              <span>{browserCollapsed ? "\u25B8" : "\u25BE"} Browser Tabs</span>
              <span className="badge">{browserEntries.length}</span>
            </div>
            <div className="sidebar-group-content">
              {browserEntries.map(renderItem)}
            </div>
          </div>
        )}

        {manualEntries.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-header">Manual</div>
            <div className="sidebar-group-content">
              {manualEntries.map(renderItem)}
            </div>
          </div>
        )}
      </div>

      <div className="add-provider">
        <form onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="ws://... or /tmp/slop/..."
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
      </div>
    </div>
  );
}
