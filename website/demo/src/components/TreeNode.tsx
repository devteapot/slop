import { useState } from "react";
import type { SlopNode } from "@slop-ai/core";

const TYPE_COLORS: Record<string, string> = {
  root: "text-primary",
  collection: "text-secondary",
  item: "text-on-surface-variant/60",
  view: "text-amber",
  status: "text-amber/70",
  group: "text-on-surface-variant/60",
};

// Props to hide from the tree display (noisy, redundant with label)
const HIDDEN_PROPS = new Set(["label", "title", "name", "description", "text", "empty"]);

function formatValue(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 20 ? `"${v.slice(0, 20)}..."` : `"${v}"`;
  }
  if (v === null) return "null";
  return JSON.stringify(v);
}

export function TreeNode({
  node,
  depth = 0,
  changedPaths,
  currentPath = "",
}: {
  node: SlopNode;
  depth?: number;
  changedPaths: Set<string>;
  currentPath?: string;
}) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const hasAffordances = (node.affordances?.length ?? 0) > 0;
  const expandable = hasChildren || hasAffordances;
  const isChanged = changedPaths.has(currentPath);
  const props = node.properties ?? {};

  const visibleProps = Object.entries(props).filter(([k]) => !HIDDEN_PROPS.has(k));
  const label = (props.name ?? props.label ?? props.title ?? node.id) as string;
  const isItem = node.type === "item";

  return (
    <div>
      {/* Main row */}
      <div
        className={`flex items-center gap-1.5 py-px rounded-sm cursor-default group ${
          isChanged ? "flash-change" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => expandable && setCollapsed(!collapsed)}
      >
        {/* Collapse toggle */}
        {expandable ? (
          <span className="text-[10px] text-on-surface-variant/40 group-hover:text-on-surface-variant w-3 flex-shrink-0 select-none">
            {collapsed ? "▸" : "▾"}
          </span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Type dot + label */}
        {!isItem ? (
          <>
            <span className={`text-[9px] font-mono uppercase tracking-wider flex-shrink-0 opacity-70 ${TYPE_COLORS[node.type] ?? "text-on-surface-variant"}`}>
              {node.type}
            </span>
            <span className="text-xs text-on-surface font-medium truncate">
              {label}
            </span>
          </>
        ) : (
          <span className="text-xs text-on-surface-variant truncate">
            {label}
          </span>
        )}

        {/* Key props inline — max 3, short */}
        {visibleProps.length > 0 && (
          <span className="text-[9px] font-mono text-on-surface-variant/50 truncate ml-1">
            {visibleProps
              .slice(0, 3)
              .map(([k, v]) => {
                // For booleans and numbers, show compact
                if (typeof v === "boolean") return v ? k : `!${k}`;
                if (typeof v === "number") return `${k}=${v}`;
                return `${k}=${formatValue(v)}`;
              })
              .join("  ")}
          </span>
        )}
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <>
          {/* Additional props (if more than 3) */}
          {visibleProps.length > 3 && (
            <div
              className="text-[9px] font-mono text-on-surface-variant/40 py-px"
              style={{ paddingLeft: `${depth * 16 + 26}px` }}
            >
              {visibleProps.slice(3).map(([k, v]) => (
                <span key={k} className="mr-3">{k}={formatValue(v)}</span>
              ))}
            </div>
          )}

          {/* Affordances as subtle inline tags */}
          {hasAffordances && (
            <div
              className="flex flex-wrap gap-1 py-px"
              style={{ paddingLeft: `${depth * 16 + 26}px` }}
            >
              {node.affordances!.map((a) => (
                <span
                  key={a.action}
                  className={`font-mono text-[8px] px-1 rounded ${
                    a.dangerous
                      ? "bg-error/10 text-error/70"
                      : "bg-primary/8 text-primary/50"
                  }`}
                >
                  {a.action}
                </span>
              ))}
            </div>
          )}

          {/* Children */}
          {hasChildren &&
            node.children!.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                changedPaths={changedPaths}
                currentPath={`${currentPath}/${child.id}`}
              />
            ))}
        </>
      )}
    </div>
  );
}
