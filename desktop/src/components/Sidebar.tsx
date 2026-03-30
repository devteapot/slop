import { useState, useEffect, useCallback, useMemo } from "react";
import { useProviderStore, type ProviderEntry } from "../hooks/use-provider-store";
import { useWorkspaceStore, type PinnedProvider } from "../hooks/use-workspace-store";

// ---------------------------------------------------------------------------
// Transport badge label
// ---------------------------------------------------------------------------

function transportLabel(entry: ProviderEntry): string {
  if (entry.source === "bridge") {
    return entry.bridgeTransport === "ws" ? "ws" : "pm";
  }
  return entry.transportType === "unix" ? "sock" : "ws";
}

// ---------------------------------------------------------------------------
// Sidebar — fully workspace-scoped
// ---------------------------------------------------------------------------

export function Sidebar() {
  const providers = useProviderStore((s) => s.providers);
  const connectProvider = useProviderStore((s) => s.connectProvider);
  const disconnectProvider = useProviderStore((s) => s.disconnectProvider);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const addManualProvider = useProviderStore((s) => s.addManualProvider);
  const removeProvider = useProviderStore((s) => s.removeProvider);
  const loadDiscoveredProviders = useProviderStore((s) => s.loadDiscoveredProviders);
  const startBridgeListener = useProviderStore((s) => s.startBridgeListener);

  const workspace = useWorkspaceStore((s) => s.getActiveWorkspace());
  const addProviderToWorkspace = useWorkspaceStore((s) => s.addProviderToWorkspace);
  const removeProviderFromWorkspace = useWorkspaceStore((s) => s.removeProviderFromWorkspace);
  const pinProvider = useWorkspaceStore((s) => s.pinProvider);
  const unpinProvider = useWorkspaceStore((s) => s.unpinProvider);

  const [url, setUrl] = useState("");
  const [browserCollapsed, setBrowserCollapsed] = useState(true);

  // ---- bootstrap ----
  useEffect(() => {
    loadDiscoveredProviders();
    startBridgeListener();
    const interval = setInterval(loadDiscoveredProviders, 10000);
    return () => clearInterval(interval);
  }, []);

  // Note: workspace switch reconnection is handled by setActiveWorkspace in the store.
  // No auto-reconnect here — that would override explicit user disconnects.

  // ---- workspace-scoped pinned IDs ----
  const pinnedIds = useMemo(
    () => new Set(workspace.pinnedProviders.map(p => p.id)),
    [workspace.pinnedProviders]
  );

  // ---- determine effective status: only show as "connected" if in this workspace ----
  function effectiveStatus(entry: ProviderEntry): ProviderEntry["status"] {
    if (entry.status !== "connected") return entry.status;
    // If connected but not in this workspace's providerIds, show as available
    if (!workspace.providerIds.includes(entry.id)) return "disconnected";
    return "connected";
  }

  // ---- pin / unpin (workspace-scoped) ----
  const togglePin = useCallback(
    (e: React.MouseEvent, entry: ProviderEntry) => {
      e.stopPropagation();
      if (pinnedIds.has(entry.id)) {
        unpinProvider(workspace.id, entry.id);
      } else {
        pinProvider(workspace.id, {
          id: entry.id,
          name: entry.providerName ?? entry.name,
          url: entry.url,
          transportType: entry.transportType,
        });
      }
    },
    [workspace.id, pinnedIds],
  );

  // ---- group entries ----
  const entries = useMemo(() => Array.from(providers.values()), [providers]);

  const pinnedEntries = useMemo(() => entries.filter((e) => pinnedIds.has(e.id)), [entries, pinnedIds]);
  const localEntries = useMemo(
    () => entries.filter((e) => !pinnedIds.has(e.id) && e.source === "discovered"),
    [entries, pinnedIds],
  );
  const browserEntries = useMemo(
    () => entries.filter((e) => !pinnedIds.has(e.id) && e.source === "bridge"),
    [entries, pinnedIds],
  );
  const manualEntries = useMemo(
    () => entries.filter((e) => !pinnedIds.has(e.id) && e.source === "manual"),
    [entries, pinnedIds],
  );

  // ---- actions ----
  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    const id = addManualProvider(url.trim());
    setUrl("");
    connectProvider(id)
      .then(() => addProviderToWorkspace(workspace.id, id))
      .catch(() => {});
  }

  function handleClick(id: string) {
    const entry = providers.get(id);
    if (!entry) return;

    const inWorkspace = workspace.providerIds.includes(id);

    if (entry.status === "connected" && inWorkspace) {
      // Already connected in this workspace — just set active
      setActiveProvider(id);
    } else if (entry.status === "connected" && !inWorkspace) {
      // Connected globally but not in this workspace — add to workspace
      addProviderToWorkspace(workspace.id, id);
      setActiveProvider(id);
    } else {
      // Disconnected — connect and add to workspace
      connectProvider(id)
        .then(() => {
          setActiveProvider(id);
          addProviderToWorkspace(workspace.id, id);
        })
        .catch(() => {});
    }
  }

  function handleDisconnect(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    disconnectProvider(id);
    removeProviderFromWorkspace(workspace.id, id);
  }

  function handleRemove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    removeProvider(id);
    removeProviderFromWorkspace(workspace.id, id);
    if (pinnedIds.has(id)) {
      unpinProvider(workspace.id, id);
    }
  }

  // ---- render a single provider item ----
  function renderItem(entry: ProviderEntry) {
    const isPinned = pinnedIds.has(entry.id);
    const status = effectiveStatus(entry);
    const isInWorkspace = workspace.providerIds.includes(entry.id);

    return (
      <div
        key={entry.id}
        className={`provider-item${isInWorkspace && status === "connected" ? " active" : ""}`}
        onClick={() => handleClick(entry.id)}
      >
        <span className={`status-dot ${status}`} />
        <span className="name" title={entry.url}>
          {entry.providerName ?? entry.name}
        </span>
        <span className="transport-badge">{transportLabel(entry)}</span>

        <span className="provider-actions">
          <button
            className="pin-btn"
            title={isPinned ? "Unpin" : "Pin"}
            onClick={(e) => togglePin(e, entry)}
          >
            {isPinned ? "\u2605" : "\u2606"}
          </button>
          {status === "connected" && (
            <button
              className="remove-btn"
              title="Disconnect"
              onClick={(e) => handleDisconnect(e, entry.id)}
            >
              &#x23FB;
            </button>
          )}
          {entry.source === "manual" && status === "disconnected" && (
            <button
              className="remove-btn"
              title="Remove"
              onClick={(e) => handleRemove(e, entry.id)}
            >
              &times;
            </button>
          )}
        </span>
      </div>
    );
  }

  // ---- render ----
  const showEmpty = entries.length === 0;

  return (
    <div className="sidebar">
      <div className="sidebar-header">Providers</div>

      <div className="provider-list">
        {showEmpty && (
          <div style={{ padding: "16px", color: "#6e7681", fontSize: "12px", textAlign: "center" }}>
            No providers yet. Add a WebSocket URL or socket path below.
          </div>
        )}

        {pinnedEntries.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-header">Pinned</div>
            <div className="sidebar-group-content">
              {pinnedEntries.map(renderItem)}
            </div>
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
              onClick={() => setBrowserCollapsed((c) => !c)}
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
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
      </div>
    </div>
  );
}
