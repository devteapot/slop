import { useState, useEffect } from "react";
import { useProviderStore } from "../hooks/use-provider-store";

export function Sidebar() {
  const providers = useProviderStore(s => s.providers);
  const activeProviderId = useProviderStore(s => s.activeProviderId);
  const connectProvider = useProviderStore(s => s.connectProvider);
  const disconnectProvider = useProviderStore(s => s.disconnectProvider);
  const setActiveProvider = useProviderStore(s => s.setActiveProvider);
  const addManualProvider = useProviderStore(s => s.addManualProvider);
  const removeProvider = useProviderStore(s => s.removeProvider);
  const loadDiscoveredProviders = useProviderStore(s => s.loadDiscoveredProviders);
  const startBridgeListener = useProviderStore(s => s.startBridgeListener);

  const [url, setUrl] = useState("");

  useEffect(() => {
    loadDiscoveredProviders();
    startBridgeListener();
    const interval = setInterval(loadDiscoveredProviders, 10000);
    return () => clearInterval(interval);
  }, []);

  const entries = Array.from(providers.values());

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    const id = addManualProvider(url.trim());
    setUrl("");
    connectProvider(id).catch(() => {});
  }

  function handleClick(id: string) {
    const entry = providers.get(id);
    if (!entry) return;
    if (entry.status === "connected") {
      setActiveProvider(id);
    } else if (entry.status === "disconnected") {
      connectProvider(id).catch(() => {});
    }
  }

  function handleDisconnect(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    disconnectProvider(id);
  }

  function handleRemove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    removeProvider(id);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">Providers</div>
      <div className="provider-list">
        {entries.length === 0 && (
          <div style={{ padding: "16px", color: "#6e7681", fontSize: "12px", textAlign: "center" }}>
            No providers yet. Add a WebSocket URL or socket path below.
          </div>
        )}
        {entries.map(entry => (
          <div
            key={entry.id}
            className={`provider-item${entry.id === activeProviderId ? " active" : ""}`}
            onClick={() => handleClick(entry.id)}
          >
            <span className={`status-dot ${entry.status}`} />
            <span className="name" title={entry.url}>
              {entry.providerName ?? entry.name}
            </span>
            <span style={{ fontSize: "10px", color: "#6e7681", flexShrink: 0 }}>
              {entry.transportType === "unix" ? "sock" : "ws"}
            </span>
            {entry.status === "connected" && (
              <button
                className="remove-btn"
                title="Disconnect"
                onClick={e => handleDisconnect(e, entry.id)}
              >
                &#x23FB;
              </button>
            )}
            {entry.source === "manual" && entry.status === "disconnected" && (
              <button
                className="remove-btn"
                title="Remove"
                onClick={e => handleRemove(e, entry.id)}
              >
                &times;
              </button>
            )}
          </div>
        ))}
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
