import { useRef, useEffect, useState, useCallback } from "react";
import { transport } from "../slop";
import { TreeNode } from "../components/TreeNode";
import type { SlopNode } from "@slop-ai/core";

export function TreePanel() {
  const [tree, setTree] = useState<SlopNode | null>(null);
  const [version, setVersion] = useState(0);
  const [changedPaths, setChangedPaths] = useState<Set<string>>(new Set());
  const prevPropsRef = useRef<Map<string, string>>(new Map());

  // Collect a fingerprint map of path → serialized properties
  const fingerprint = useCallback((node: SlopNode, prefix = ""): Map<string, string> => {
    const map = new Map<string, string>();
    const path = prefix ? `${prefix}/${node.id}` : "";
    if (path) {
      map.set(path, JSON.stringify(node.properties ?? {}));
    }
    for (const child of node.children ?? []) {
      for (const [k, v] of fingerprint(child, path || "")) {
        map.set(k, v);
      }
    }
    return map;
  }, []);

  useEffect(() => {
    // Listen to all provider messages (snapshots + patches)
    const unsub = transport.onProviderMessage((msg) => {
      if (msg.type === "snapshot") {
        setTree(msg.tree);
        setVersion(msg.version);
        prevPropsRef.current = fingerprint(msg.tree);
      }

      if (msg.type === "patch") {
        // Extract changed paths directly from patch ops
        const changed = new Set<string>();
        for (const op of msg.ops ?? []) {
          // op.path is like "/shop/catalog/properties/query"
          // Extract the node path (everything before /properties, /affordances, etc.)
          const nodePath = op.path.replace(/\/(properties|affordances|meta|children|content_ref)\/.*$/, "");
          changed.add(nodePath);
        }

        setChangedPaths(changed);
        setVersion(msg.version);

        // Re-read the tree from the snapshot subscription
        // The provider sends patches relative to the subscribed tree
        // We need the updated tree — request a fresh read
        transport.sendToProvider({ type: "query", id: `tree-read-${msg.version}`, path: "/", depth: -1 });
      }

      // Handle query response (our tree re-read after patch)
      if (msg.type === "snapshot" && msg.id?.startsWith("tree-read-")) {
        setTree(msg.tree);

        // Diff against previous to find changed paths
        const current = fingerprint(msg.tree);
        const changed = new Set<string>();
        for (const [path, props] of current) {
          if (prevPropsRef.current.get(path) !== props) changed.add(path);
        }
        // New nodes
        for (const path of current.keys()) {
          if (!prevPropsRef.current.has(path)) changed.add(path);
        }
        prevPropsRef.current = current;

        if (changed.size > 0) {
          setChangedPaths(changed);
          const timer = setTimeout(() => setChangedPaths(new Set()), 1600);
          // No cleanup needed — fire and forget
        }
      }
    });

    // Subscribe — listener is already registered, so the snapshot will be received
    transport.sendToProvider({ type: "subscribe", id: "demo-sub", path: "/", depth: -1 });

    return unsub;
  }, [fingerprint]);

  // Clear highlights after animation
  useEffect(() => {
    if (changedPaths.size === 0) return;
    const timer = setTimeout(() => setChangedPaths(new Set()), 1600);
    return () => clearTimeout(timer);
  }, [changedPaths]);

  return (
    <div className="flex flex-col h-full bg-surface-lowest overflow-hidden">
      {/* Header */}
      <div className="px-3 flex items-center h-10 bg-surface-container">
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          State Tree
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant ml-2">
          v{version}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2 font-mono">
        {tree ? (
          <TreeNode node={tree} changedPaths={changedPaths} />
        ) : (
          <p className="text-xs text-on-surface-variant p-2">Waiting for snapshot...</p>
        )}
      </div>
    </div>
  );
}
