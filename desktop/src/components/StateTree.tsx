import { useProviderStore } from "../hooks/use-provider-store";
import { useWorkspaceStore } from "../hooks/use-workspace-store";
import { formatTree, affordancesToTools } from "@slop-ai/consumer/browser";

export function StateTree() {
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  const providers = useProviderStore(s => s.providers);

  const connectedProviders = workspace.providerIds
    .map(id => providers.get(id))
    .filter(p => p?.currentTree && p.status === "connected");

  const totalAffordances = connectedProviders.reduce(
    (sum, p) => sum + affordancesToTools(p!.currentTree!).length,
    0
  );

  return (
    <div className="state-tree">
      <div className="state-tree-header">
        <span>State Tree</span>
        {connectedProviders.length > 0 && (
          <span style={{ fontSize: "10px", fontWeight: "normal" }}>
            {connectedProviders.length} provider{connectedProviders.length > 1 ? "s" : ""} · {totalAffordances} affordances
          </span>
        )}
      </div>
      {connectedProviders.length > 0 ? (
        <div className="state-tree-content">
          {connectedProviders.map(p => (
            <div key={p!.id}>
              {connectedProviders.length > 1 && (
                <div style={{ color: "#91db37", marginBottom: 4 }}>
                  --- {p!.providerName ?? p!.name} ---
                </div>
              )}
              {formatTree(p!.currentTree!)}
              {"\n"}
            </div>
          ))}
        </div>
      ) : (
        <div className="state-tree-empty">No providers connected</div>
      )}
    </div>
  );
}
