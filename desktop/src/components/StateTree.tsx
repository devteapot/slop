import { useAppStore } from "../stores/app-store";
import type { SlopNode } from "../lib/types";

function formatNode(node: SlopNode, indent: number = 0): string {
  const pad = " ".repeat(indent);
  let out = `${pad}[${node.id}] (${node.type})`;

  if (node.properties) {
    const pairs = Object.entries(node.properties)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (pairs) out += ` {${pairs}}`;
  }

  if (node.meta?.summary) {
    out += ` — ${node.meta.summary}`;
  }

  out += "\n";

  if (node.affordances) {
    for (const aff of node.affordances) {
      out += `${pad}  -> ${aff.action}`;
      if (aff.label) out += ` (${aff.label})`;
      out += "\n";
    }
  }

  if (node.children) {
    for (const child of node.children) {
      out += formatNode(child, indent + 2);
    }
  }

  return out;
}

export function StateTree() {
  const providerTrees = useAppStore(s => s.providerTrees);
  const providers = useAppStore(s => s.providers);

  const connected = providers.filter(p => p.status === "connected");
  const treePairs = connected
    .map(p => ({ provider: p, tree: providerTrees[p.id] }))
    .filter((x): x is { provider: typeof x.provider; tree: SlopNode } => !!x.tree);

  const totalAffordances = treePairs.reduce((sum, { tree }) => {
    let count = 0;
    function walk(n: SlopNode) {
      count += n.affordances?.length ?? 0;
      n.children?.forEach(walk);
    }
    walk(tree);
    return sum + count;
  }, 0);

  return (
    <div className="state-tree">
      <div className="state-tree-header">
        <span>State Tree</span>
        {treePairs.length > 0 && (
          <span style={{ fontSize: "10px", fontWeight: "normal" }}>
            {treePairs.length} provider{treePairs.length > 1 ? "s" : ""} · {totalAffordances} affordances
          </span>
        )}
      </div>
      {treePairs.length > 0 ? (
        <div className="state-tree-content">
          {treePairs.map(({ provider, tree }) => (
            <div key={provider.id}>
              {treePairs.length > 1 && (
                <div style={{ color: "#91db37", marginBottom: 4 }}>
                  --- {provider.provider_name ?? provider.name} ---
                </div>
              )}
              {formatNode(tree)}
            </div>
          ))}
        </div>
      ) : (
        <div className="state-tree-empty">No providers connected</div>
      )}
    </div>
  );
}
