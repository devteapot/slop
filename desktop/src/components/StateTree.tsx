import { useProviderStore } from "../hooks/use-provider-store";
import { formatTree, affordancesToTools } from "@slop/consumer/browser";

export function StateTree() {
  const activeProvider = useProviderStore(s => s.getActiveProvider());
  const tree = activeProvider?.currentTree;

  return (
    <div className="state-tree">
      <div className="state-tree-header">
        <span>State Tree</span>
        {tree && (
          <span style={{ fontSize: "10px", fontWeight: "normal" }}>
            {affordancesToTools(tree).length} affordances
          </span>
        )}
      </div>
      {tree ? (
        <div className="state-tree-content">{formatTree(tree)}</div>
      ) : (
        <div className="state-tree-empty">No state available</div>
      )}
    </div>
  );
}
