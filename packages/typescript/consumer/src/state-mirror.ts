import type { SlopNode, PatchOp, SnapshotMessage, PatchMessage } from "./types";

const NODE_FIELDS = new Set(["properties", "meta", "affordances", "content_ref"]);

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

  getTree(): SlopNode { return this.tree; }
  getVersion(): number { return this.version; }

  private applyOp(op: PatchOp): void {
    const segments = op.path.split("/").filter(Boolean);
    if (segments.length === 0) return;
    switch (op.op) {
      case "add": this.applyAdd(segments, op.value); break;
      case "remove": this.applyRemove(segments); break;
      case "replace": this.applyReplace(segments, op.value); break;
    }
  }

  /**
   * Navigate to { parent, key } for the last segment.
   * Non-field segments are treated as child IDs.
   */
  private navigate(segments: string[]): { parent: any; key: string } | null {
    let current: any = this.tree;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (NODE_FIELDS.has(seg)) {
        current = current[seg];
        if (current === undefined) return null;
      } else {
        // Child ID lookup
        const child = (current.children as SlopNode[])?.find(c => c.id === seg);
        if (!child) return null;
        current = child;
      }
    }
    return { parent: current, key: segments[segments.length - 1] };
  }

  private applyAdd(segments: string[], value: unknown): void {
    // Adding a child node: last segment is a child ID, parent is a node
    if (!this.isFieldSegment(segments)) {
      const parent = this.resolveNode(segments.slice(0, -1));
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(value as SlopNode);
      }
      return;
    }
    const target = this.navigate(segments);
    if (target) target.parent[target.key] = value;
  }

  private applyRemove(segments: string[]): void {
    // Removing a child node by ID
    if (!this.isFieldSegment(segments)) {
      const childId = segments[segments.length - 1];
      const parent = this.resolveNode(segments.slice(0, -1));
      if (parent?.children) {
        parent.children = parent.children.filter((c: SlopNode) => c.id !== childId);
      }
      return;
    }
    const target = this.navigate(segments);
    if (target) delete target.parent[target.key];
  }

  private applyReplace(segments: string[], value: unknown): void {
    const target = this.navigate(segments);
    if (target) target.parent[target.key] = value;
  }

  /** Check if the last segment targets a known node field (not a child ID). */
  private isFieldSegment(segments: string[]): boolean {
    // Walk backwards: the last segment is the target. If any ancestor segment
    // is a node field, then we're inside that field, not at child level.
    // If the last segment itself is a field, or the second-to-last is a field,
    // then it's a field access.
    if (segments.length === 1) return NODE_FIELDS.has(segments[0]);
    // If the penultimate segment is a known field, this is a key within that field
    const penultimate = segments[segments.length - 2];
    if (NODE_FIELDS.has(penultimate)) return true;
    // If we're deeper inside properties (e.g. /child/properties/nested/key)
    for (let i = segments.length - 2; i >= 0; i--) {
      if (NODE_FIELDS.has(segments[i])) return true;
    }
    return false;
  }

  private resolveNode(segments: string[]): SlopNode | null {
    if (segments.length === 0) return this.tree;
    let current: SlopNode = this.tree;
    for (const seg of segments) {
      if (NODE_FIELDS.has(seg)) continue; // skip field keywords
      const child = current.children?.find(c => c.id === seg);
      if (!child) return null;
      current = child;
    }
    return current;
  }
}
