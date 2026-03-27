import type { Connection, PatchOp } from "@slop/types";

export interface Subscription {
  id: string;
  path: string;
  depth: number;
  connection: Connection;
  lastVersion: number;
}

export class SubscriptionManager {
  private subs = new Map<string, Subscription>();

  add(sub: Subscription): void {
    this.subs.set(sub.id, sub);
  }

  remove(id: string): void {
    this.subs.delete(id);
  }

  removeByConnection(connection: Connection): void {
    for (const [id, sub] of this.subs) {
      if (sub.connection === connection) {
        this.subs.delete(id);
      }
    }
  }

  /** Get all subscriptions whose path overlaps with the tree root (all subs for MVP) */
  getAll(): Subscription[] {
    return Array.from(this.subs.values());
  }

  /** Filter ops to only those within a subscription's path prefix */
  filterOps(sub: Subscription, ops: PatchOp[]): PatchOp[] {
    if (sub.path === "/" || sub.path === "") return ops;
    return ops.filter(
      (op) => op.path === sub.path || op.path.startsWith(sub.path + "/")
    );
  }
}
