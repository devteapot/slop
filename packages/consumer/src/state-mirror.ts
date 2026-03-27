import type { SlopNode, PatchOp, SnapshotMessage, PatchMessage } from "@slop/types";

/**
 * Holds a local copy of a subscribed subtree and applies SLOP patches.
 * SLOP patches use node IDs in children segments, not array indices.
 */
export class StateMirror {
  private tree: SlopNode;
  private version: number;

  constructor(snapshot: SnapshotMessage) {
    this.tree = structuredClone(snapshot.tree);
    this.version = snapshot.version;
  }

  applyPatch(patch: PatchMessage): void {
    for (const op of patch.ops) {
      this.applyOp(op);
    }
    this.version = patch.version;
  }

  getTree(): SlopNode {
    return this.tree;
  }

  getVersion(): number {
    return this.version;
  }

  private applyOp(op: PatchOp): void {
    const segments = this.parsePath(op.path);
    if (segments.length === 0) return;

    switch (op.op) {
      case "add":
        this.applyAdd(segments, op.value);
        break;
      case "remove":
        this.applyRemove(segments);
        break;
      case "replace":
        this.applyReplace(segments, op.value);
        break;
    }
  }

  /**
   * Parse a SLOP patch path into segments.
   * "/children/todo-3/properties/done" → ["children", "todo-3", "properties", "done"]
   */
  private parsePath(path: string): string[] {
    return path.split("/").filter(Boolean);
  }

  /**
   * Navigate the tree to find the parent context and the last segment.
   * For children segments, we look up by node ID rather than array index.
   */
  private navigate(segments: string[]): { parent: any; key: string } | null {
    let current: any = this.tree;

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (seg === "children") {
        // Next segment is a child ID
        const childId = segments[i + 1];
        const child = (current.children as SlopNode[])?.find(
          (c) => c.id === childId
        );
        if (!child) return null;
        current = child;
        i++; // skip the ID segment
      } else if (seg === "properties" || seg === "meta" || seg === "affordances") {
        current = current[seg];
        if (current === undefined) return null;
      } else {
        current = current[seg];
        if (current === undefined) return null;
      }
    }

    return { parent: current, key: segments[segments.length - 1] };
  }

  private applyAdd(segments: string[], value: unknown): void {
    // Special case: adding a child node
    if (segments.length >= 2 && segments[segments.length - 2] === "children") {
      const parentSegments = segments.slice(0, -2);
      const parent = this.resolveNode(parentSegments);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(value as SlopNode);
      }
      return;
    }

    const target = this.navigate(segments);
    if (target) {
      target.parent[target.key] = value;
    }
  }

  private applyRemove(segments: string[]): void {
    // Special case: removing a child node
    if (segments.length >= 2 && segments[segments.length - 2] === "children") {
      const childId = segments[segments.length - 1];
      const parentSegments = segments.slice(0, -2);
      const parent = this.resolveNode(parentSegments);
      if (parent?.children) {
        parent.children = parent.children.filter((c: SlopNode) => c.id !== childId);
      }
      return;
    }

    const target = this.navigate(segments);
    if (target) {
      delete target.parent[target.key];
    }
  }

  private applyReplace(segments: string[], value: unknown): void {
    const target = this.navigate(segments);
    if (target) {
      target.parent[target.key] = value;
    }
  }

  /** Resolve a node given path segments (handling children/id pairs) */
  private resolveNode(segments: string[]): SlopNode | null {
    if (segments.length === 0) return this.tree;
    let current: SlopNode = this.tree;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === "children") {
        const childId = segments[i + 1];
        const child = current.children?.find((c) => c.id === childId);
        if (!child) return null;
        current = child;
        i++;
      }
    }
    return current;
  }
}
