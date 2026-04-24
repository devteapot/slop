import { escapeJsonPointerSegment } from "./paths";
import type { PatchOp, SlopNode } from "./types";

/**
 * Recursively diff two SLOP trees and produce JSON Patch ops.
 * Paths use node IDs in children segments (not array indices).
 */
export function diffNodes(oldNode: SlopNode, newNode: SlopNode, basePath: string = ""): PatchOp[] {
  const ops: PatchOp[] = [];

  // Diff properties key-by-key
  const oldProps = oldNode.properties ?? {};
  const newProps = newNode.properties ?? {};
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of allKeys) {
    const oldVal = oldProps[key];
    const newVal = newProps[key];
    const escapedKey = escapeJsonPointerSegment(key);
    if (oldVal === undefined && newVal !== undefined) {
      ops.push({ op: "add", path: `${basePath}/properties/${escapedKey}`, value: newVal });
    } else if (oldVal !== undefined && newVal === undefined) {
      ops.push({ op: "remove", path: `${basePath}/properties/${escapedKey}` });
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      ops.push({ op: "replace", path: `${basePath}/properties/${escapedKey}`, value: newVal });
    }
  }

  // Diff affordances (replace entire array if changed)
  if (JSON.stringify(oldNode.affordances) !== JSON.stringify(newNode.affordances)) {
    if (newNode.affordances) {
      ops.push({
        op: oldNode.affordances ? "replace" : "add",
        path: `${basePath}/affordances`,
        value: newNode.affordances,
      });
    } else if (oldNode.affordances) {
      ops.push({ op: "remove", path: `${basePath}/affordances` });
    }
  }

  // Diff meta (replace entire object if changed)
  if (JSON.stringify(oldNode.meta) !== JSON.stringify(newNode.meta)) {
    if (newNode.meta) {
      ops.push({
        op: oldNode.meta ? "replace" : "add",
        path: `${basePath}/meta`,
        value: newNode.meta,
      });
    } else if (oldNode.meta) {
      ops.push({ op: "remove", path: `${basePath}/meta` });
    }
  }

  // Diff content_ref (replace entire object if changed)
  if (JSON.stringify(oldNode.content_ref) !== JSON.stringify(newNode.content_ref)) {
    if (newNode.content_ref) {
      ops.push({
        op: oldNode.content_ref ? "replace" : "add",
        path: `${basePath}/content_ref`,
        value: newNode.content_ref,
      });
    } else if (oldNode.content_ref) {
      ops.push({ op: "remove", path: `${basePath}/content_ref` });
    }
  }

  // Diff children — simulate apply order so indices stay accurate.
  const oldChildren = oldNode.children ?? [];
  const newChildren = newNode.children ?? [];
  const oldMap = new Map(oldChildren.map((c) => [c.id, c]));
  const newMap = new Map(newChildren.map((c) => [c.id, c]));

  // 1. Remove children no longer present.
  const working: string[] = [];
  for (const child of oldChildren) {
    if (!newMap.has(child.id)) {
      ops.push({ op: "remove", path: `${basePath}/${child.id}` });
    } else {
      working.push(child.id);
    }
  }

  // 2. Insert new children at their target positions.
  for (let i = 0; i < newChildren.length; i++) {
    const child = newChildren[i];
    if (!oldMap.has(child.id)) {
      ops.push({ op: "add", path: `${basePath}/${child.id}`, value: child, index: i });
      working.splice(i, 0, child.id);
    }
  }

  // 3. Emit move ops until the working order matches the target order.
  for (let i = 0; i < newChildren.length; i++) {
    const targetId = newChildren[i].id;
    if (working[i] === targetId) continue;
    const currentIdx = working.indexOf(targetId, i);
    if (currentIdx === -1) continue;
    ops.push({ op: "move", path: `${basePath}/${targetId}`, index: i });
    working.splice(currentIdx, 1);
    working.splice(i, 0, targetId);
  }

  // 4. Recurse into kept children.
  for (const child of newChildren) {
    const oldChild = oldMap.get(child.id);
    if (oldChild) {
      ops.push(...diffNodes(oldChild, child, `${basePath}/${child.id}`));
    }
  }

  return ops;
}
