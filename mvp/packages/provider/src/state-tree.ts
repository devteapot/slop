import type { SlopNode, NodeStub, PatchOp } from "@slop/types";
import { diffNodes } from "./diff";

export class StateTree {
  private root: SlopNode;
  private version: number = 0;

  constructor(root: SlopNode) {
    this.root = root;
  }

  getVersion(): number {
    return this.version;
  }

  getRoot(): SlopNode {
    return this.root;
  }

  /** Resolve a path like "/todos/todo-3" to a node */
  resolve(path: string): SlopNode | null {
    if (path === "/" || path === "") return this.root;
    const segments = path.split("/").filter(Boolean);
    let current: SlopNode = this.root;
    for (const seg of segments) {
      const child = current.children?.find((c) => c.id === seg);
      if (!child) return null;
      current = child;
    }
    return current;
  }

  /** Resolve a subtree at given depth, truncating deeper nodes to stubs */
  resolveAtDepth(path: string, depth: number): SlopNode | NodeStub | null {
    const node = this.resolve(path);
    if (!node) return null;
    if (depth === -1) return structuredClone(node);
    return this.truncate(node, depth);
  }

  private truncate(node: SlopNode, depth: number): SlopNode | NodeStub {
    if (depth === 0 && node.children?.length) {
      // Return a stub with summary info
      const stub: NodeStub = {
        id: node.id,
        type: node.type,
        meta: {
          ...node.meta,
          total_children: node.children.length,
          summary: node.meta?.summary,
        },
      };
      return stub;
    }
    // Clone and truncate children
    const clone: SlopNode = {
      ...node,
      children: node.children?.map((child) =>
        this.truncate(child, depth - 1) as SlopNode
      ),
    };
    return clone;
  }

  /** Replace the entire tree, compute diff, increment version */
  setTree(newRoot: SlopNode): PatchOp[] {
    const ops = diffNodes(this.root, newRoot);
    this.root = newRoot;
    if (ops.length > 0) {
      this.version++;
    }
    return ops;
  }
}
