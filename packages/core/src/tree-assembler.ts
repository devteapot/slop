import type { SlopNode, ActionHandler, NodeDescriptor } from "./types";
import { normalizeDescriptor } from "./descriptor";

export interface AssemblyResult {
  tree: SlopNode;
  handlers: Map<string, ActionHandler>;
}

/**
 * Build a hierarchical SLOP tree from a flat map of path → descriptor registrations.
 * Paths encode hierarchy: "inbox/messages" becomes a child of "inbox".
 */
export function assembleTree(
  registrations: Map<string, NodeDescriptor>,
  rootId: string,
  rootName: string
): AssemblyResult {
  const allHandlers = new Map<string, ActionHandler>();
  const nodesByPath = new Map<string, SlopNode>();

  // Sort paths by depth (shallowest first), then alphabetically
  const sortedPaths = [...registrations.keys()].sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    return depthA !== depthB ? depthA - depthB : a.localeCompare(b);
  });

  // Normalize each registration into a SlopNode
  for (const path of sortedPaths) {
    const descriptor = registrations.get(path)!;
    const id = path.split("/").pop()!;
    const { node, handlers } = normalizeDescriptor(path, id, descriptor);
    nodesByPath.set(path, node);
    for (const [k, v] of handlers) allHandlers.set(k, v);
  }

  // Build the root node
  const root: SlopNode = {
    id: rootId,
    type: "root",
    properties: { label: rootName },
    children: [],
  };

  // Attach each node to its parent
  for (const path of sortedPaths) {
    const node = nodesByPath.get(path)!;
    const parentPath = getParentPath(path);

    if (parentPath === "") {
      // Top-level node — attach to root
      addChild(root, node);
    } else {
      // Find or create parent
      const parent = ensureNode(parentPath, nodesByPath, root);
      addChild(parent, node);
    }
  }

  return { tree: root, handlers: allHandlers };
}

/** Get the parent path: "inbox/messages" → "inbox", "inbox" → "" */
function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.substring(0, lastSlash);
}

/**
 * Ensure a node exists at the given path, creating synthetic placeholders
 * as needed for missing ancestors.
 */
function ensureNode(
  path: string,
  nodesByPath: Map<string, SlopNode>,
  root: SlopNode
): SlopNode {
  // Already exists
  const existing = nodesByPath.get(path);
  if (existing) return existing;

  // Create synthetic placeholder
  const id = path.split("/").pop()!;
  const synthetic: SlopNode = { id, type: "group", children: [] };
  nodesByPath.set(path, synthetic);

  // Attach the synthetic to its own parent (recursive)
  const parentPath = getParentPath(path);
  if (parentPath === "") {
    addChild(root, synthetic);
  } else {
    const parent = ensureNode(parentPath, nodesByPath, root);
    addChild(parent, synthetic);
  }

  return synthetic;
}

/** Add a child to a node, replacing any existing child with the same id */
function addChild(parent: SlopNode, child: SlopNode): void {
  if (!parent.children) parent.children = [];

  const existingIdx = parent.children.findIndex((c) => c.id === child.id);
  if (existingIdx !== -1) {
    // Merge: if the existing node was a synthetic placeholder,
    // keep its children but take everything else from the new node
    const existing = parent.children[existingIdx];
    if (existing.type === "group" && !existing.properties) {
      // Synthetic — transfer its children to the real node
      if (existing.children?.length && !child.children?.length) {
        child.children = existing.children;
      } else if (existing.children?.length && child.children?.length) {
        // Merge children: child's inline children + synthetic's attached children
        const childIds = new Set(child.children.map((c) => c.id));
        for (const ec of existing.children) {
          if (!childIds.has(ec.id)) {
            child.children.push(ec);
          }
        }
      }
    }
    parent.children[existingIdx] = child;
  } else {
    parent.children.push(child);
  }
}
