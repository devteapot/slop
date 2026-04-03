import { useState, useCallback } from "react";
import type { SlopNode } from "./engine";

const TYPE_COLORS: Record<string, string> = {
  root: "text-primary",
  collection: "text-secondary",
  item: "text-on-surface-variant/60",
  view: "text-amber",
  status: "text-amber/70",
  group: "text-on-surface-variant/60",
};

const HIDDEN_PROPS = new Set(["label", "title", "name", "description", "text", "empty"]);

function formatValue(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 20 ? `"${v.slice(0, 20)}..."` : `"${v}"`;
  }
  if (v === null) return "null";
  return JSON.stringify(v);
}

interface TreePanelProps {
  tree: SlopNode;
  changedPaths: Set<string>;
  onInvoke: (handlerKey: string, params: Record<string, unknown>) => void;
}

export function TreePanel({ tree, changedPaths, onInvoke }: TreePanelProps) {
  return (
    <TreeNode node={tree} depth={0} changedPaths={changedPaths} currentPath="" onInvoke={onInvoke} />
  );
}

function TreeNode({
  node,
  depth = 0,
  changedPaths,
  currentPath = "",
  onInvoke,
}: {
  node: SlopNode;
  depth?: number;
  changedPaths: Set<string>;
  currentPath?: string;
  onInvoke: (handlerKey: string, params: Record<string, unknown>) => void;
}) {
  const [collapsed, setCollapsed] = useState(depth > 3);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const hasAffordances = (node.affordances?.length ?? 0) > 0;
  const expandable = hasChildren || hasAffordances;
  const isChanged = changedPaths.has(currentPath);
  const props = node.properties ?? {};

  const visibleProps = Object.entries(props).filter(([k]) => !HIDDEN_PROPS.has(k));
  const label = (props.name ?? props.label ?? props.title ?? node.id) as string;
  const isItem = node.type === "item";

  // Build handler key prefix for this node
  const handlerPrefix = currentPath ? currentPath.slice(1) : node.id;

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

        {/* Type + label */}
        {!isItem ? (
          <>
            <span
              className={`text-[11px] font-mono uppercase tracking-wider flex-shrink-0 opacity-70 ${
                TYPE_COLORS[node.type] ?? "text-on-surface-variant"
              }`}
            >
              {node.type}
            </span>
            <span className="text-sm text-on-surface font-medium whitespace-nowrap">{label}</span>
          </>
        ) : (
          <span className="text-sm text-on-surface-variant whitespace-nowrap">{label}</span>
        )}

        {/* Key props inline */}
        {visibleProps.length > 0 && (
          <span className="text-[11px] font-mono text-on-surface-variant/50 whitespace-nowrap ml-1">
            {visibleProps
              .slice(0, 3)
              .map(([k, v]) => {
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
          {/* Additional props */}
          {visibleProps.length > 3 && (
            <div
              className="text-[11px] font-mono text-on-surface-variant/40 py-px"
              style={{ paddingLeft: `${depth * 16 + 26}px` }}
            >
              {visibleProps.slice(3).map(([k, v]) => (
                <span key={k} className="mr-3">
                  {k}={formatValue(v)}
                </span>
              ))}
            </div>
          )}

          {/* Affordance buttons */}
          {hasAffordances && (
            <div
              className="flex flex-wrap gap-1 py-px"
              style={{ paddingLeft: `${depth * 16 + 26}px` }}
            >
              {node.affordances!.map((a) => (
                <ActionButton
                  key={a.action}
                  action={a.action}
                  params={a.params}
                  dangerous={a.dangerous ?? false}
                  handlerKey={`${handlerPrefix}/${a.action}`}
                  onInvoke={onInvoke}
                />
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
                onInvoke={onInvoke}
              />
            ))}
        </>
      )}
    </div>
  );
}

function ActionButton({
  action,
  params,
  dangerous,
  handlerKey,
  onInvoke,
}: {
  action: string;
  params?: { type?: string; properties?: Record<string, unknown> };
  dangerous: boolean;
  handlerKey: string;
  onInvoke: (handlerKey: string, params: Record<string, unknown>) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const hasParams = params?.properties && Object.keys(params.properties).length > 0;

  const handleClick = useCallback(() => {
    if (hasParams) {
      setShowForm(!showForm);
      return;
    }
    if (dangerous && !window.confirm(`Run dangerous action "${action}"?`)) return;
    onInvoke(handlerKey, {});
  }, [hasParams, dangerous, action, handlerKey, onInvoke, showForm]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (dangerous && !window.confirm(`Run dangerous action "${action}"?`)) return;
      onInvoke(handlerKey, formValues);
      setShowForm(false);
      setFormValues({});
    },
    [dangerous, action, handlerKey, formValues, onInvoke],
  );

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={handleClick}
        className={`font-mono text-[10px] px-1 rounded-sm cursor-pointer transition-opacity hover:opacity-100 ${
          dangerous ? "bg-error/10 text-error/70" : "bg-primary/8 text-primary/50"
        }`}
      >
        {action}
        {hasParams && (showForm ? " ▴" : " ▾")}
      </button>

      {showForm && hasParams && (
        <form onSubmit={handleSubmit} className="inline-flex items-center gap-1">
          {Object.entries(params!.properties!).map(([key, schema]) => (
            <input
              key={key}
              type="text"
              placeholder={`${key}: ${(schema as { type?: string }).type ?? "string"}`}
              value={formValues[key] ?? ""}
              onChange={(e) => setFormValues((prev) => ({ ...prev, [key]: e.target.value }))}
              className="font-mono text-[11px] px-1 py-0 rounded-sm outline-none bg-surface-lowest text-on-surface"
              style={{ width: "100px", lineHeight: "16px" }}
              autoFocus
            />
          ))}
          <button
            type="submit"
            className="font-mono text-[10px] px-1 rounded-sm cursor-pointer bg-primary/15 text-primary/70"
          >
            ↵
          </button>
        </form>
      )}
    </span>
  );
}
