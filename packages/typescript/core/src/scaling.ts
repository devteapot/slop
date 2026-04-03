/**
 * Tree scaling utilities: depth truncation, node-budget compaction,
 * salience filtering, and subtree extraction.
 *
 * These operate on wire-format SlopNodes and are used by both the
 * client (in-browser provider) and server (multi-connection provider)
 * to respect consumer token budgets.
 */

import type { SlopNode } from "./types";

/** Options for preparing a tree for output to a consumer. */
export interface OutputTreeOptions {
  /** Maximum depth to resolve. Nodes beyond this become stubs with summaries. */
  maxDepth?: number;
  /** Maximum total nodes. Lowest-salience subtrees are collapsed first. */
  maxNodes?: number;
  /** Minimum salience threshold. Nodes below this are excluded. */
  minSalience?: number;
  /** Only include nodes of these types. */
  types?: string[];
}

/**
 * Prepare a tree for output to a consumer by applying depth truncation,
 * salience filtering, type filtering, and node-budget compaction.
 */
export function prepareTree(root: SlopNode, options: OutputTreeOptions): SlopNode {
  let tree = root;
  if (options.minSalience != null || options.types != null) {
    tree = filterTree(tree, options.minSalience, options.types);
  }
  if (options.maxDepth != null) {
    tree = truncateTree(tree, options.maxDepth);
  }
  if (options.maxNodes != null) {
    tree = autoCompact(tree, options.maxNodes);
  }
  return tree;
}

/**
 * Extract a subtree rooted at the given path.
 * Path is slash-separated node IDs: "/inbox/msg-42".
 * Returns undefined if the path doesn't exist.
 */
export function getSubtree(root: SlopNode, path: string): SlopNode | undefined {
  if (!path || path === "/") return root;

  const segments = path.replace(/^\//, "").split("/").filter(Boolean);
  let current = root;

  for (const seg of segments) {
    const child = current.children?.find((c) => c.id === seg);
    if (!child) return undefined;
    current = child;
  }

  return current;
}

/**
 * Truncate a tree at the given depth. Nodes beyond the depth become stubs
 * with `meta.total_children` and `meta.summary`.
 */
export function truncateTree(node: SlopNode, depth: number): SlopNode {
  if (depth <= 0 && node.children?.length) {
    return {
      id: node.id,
      type: node.type,
      ...(node.properties && { properties: node.properties }),
      meta: {
        ...node.meta,
        total_children: node.children.length,
      },
    };
  }
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((c) => truncateTree(c, depth - 1)),
  };
}

/**
 * Compact a tree to fit within a node budget. Collapses lowest-salience
 * subtrees first, preserving root children and pinned nodes.
 */
export function autoCompact(root: SlopNode, maxNodes: number): SlopNode {
  const total = countNodes(root);
  if (total <= maxNodes) return root;

  const candidates: CompactCandidate[] = [];
  if (root.children) {
    for (let i = 0; i < root.children.length; i++) {
      collectCandidates(root.children[i], [i], candidates, false);
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const tree = structuredClone(root);
  let nodeCount = total;

  for (const candidate of candidates) {
    if (nodeCount <= maxNodes) break;
    const saved = collapseAtPath(tree, candidate.path);
    nodeCount -= saved;
  }

  return tree;
}

/**
 * Filter a tree by salience threshold and/or node types.
 * Nodes below minSalience or not matching types are removed.
 * The root node is never filtered.
 */
export function filterTree(
  node: SlopNode,
  minSalience?: number,
  types?: string[]
): SlopNode {
  if (!node.children) return node;

  const filtered = node.children
    .filter((child) => {
      if (minSalience != null) {
        const salience = child.meta?.salience ?? 0.5;
        if (salience < minSalience) return false;
      }
      if (types != null && !types.includes(child.type)) return false;
      return true;
    })
    .map((child) => filterTree(child, minSalience, types));

  return {
    ...node,
    children: filtered.length > 0 ? filtered : undefined,
  };
}

/** Count total nodes in a tree. */
export function countNodes(node: SlopNode): number {
  return (
    1 + (node.children?.reduce((sum, c) => sum + countNodes(c), 0) ?? 0)
  );
}

// --- Internal helpers ---

interface CompactCandidate {
  path: number[];
  score: number;
  childCount: number;
}

function collectCandidates(
  node: SlopNode,
  path: number[],
  candidates: CompactCandidate[],
  isRootChild: boolean = false
): void {
  if (!node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childPath = [...path, i];

    if (child.children?.length && !isRootChild && !child.meta?.pinned) {
      const childCount = countNodes(child) - 1;
      const salience = child.meta?.salience ?? 0.5;
      const depth = childPath.length;
      const score = salience - depth * 0.01 - childCount * 0.001;
      candidates.push({ path: childPath, score, childCount });
    }

    collectCandidates(child, childPath, candidates, false);
  }
}

function collapseAtPath(tree: SlopNode, path: number[]): number {
  let node = tree;
  for (let i = 0; i < path.length - 1; i++) {
    if (!node.children?.[path[i]]) return 0;
    node = node.children[path[i]];
  }

  const idx = path[path.length - 1];
  if (!node.children?.[idx]) return 0;

  const target = node.children[idx];
  const saved = countNodes(target) - 1;

  node.children[idx] = {
    id: target.id,
    type: target.type,
    ...(target.properties && { properties: target.properties }),
    ...(target.affordances && { affordances: target.affordances }),
    meta: {
      ...target.meta,
      total_children: target.children?.length ?? 0,
      summary:
        target.meta?.summary ?? `${target.children?.length ?? 0} children`,
    },
  };

  return saved;
}
