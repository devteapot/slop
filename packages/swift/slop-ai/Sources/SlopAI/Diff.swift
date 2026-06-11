import Foundation

/// Recursively diff two SLOP trees and produce JSON Patch-like operations.
/// Child paths use node IDs rather than array indices, matching the TS SDK.
public func diffNodes(_ oldNode: SlopNode, _ newNode: SlopNode, basePath: String = "") -> [PatchOp] {
  var ops: [PatchOp] = []

  let oldProperties = oldNode.properties ?? [:]
  let newProperties = newNode.properties ?? [:]
  for key in Set(oldProperties.keys).union(newProperties.keys).sorted() {
    let escapedKey = escapeJSONPointerSegment(key)
    let path = "\(basePath)/properties/\(escapedKey)"
    switch (oldProperties[key], newProperties[key]) {
    case (nil, .some(let value)):
      ops.append(PatchOp(op: .add, path: path, value: value))
    case (.some, nil):
      ops.append(PatchOp(op: .remove, path: path))
    case (.some(let oldValue), .some(let newValue)) where oldValue != newValue:
      ops.append(PatchOp(op: .replace, path: path, value: newValue))
    default:
      break
    }
  }

  if oldNode.affordances != newNode.affordances {
    if let affordances = newNode.affordances {
      ops.append(PatchOp(op: oldNode.affordances == nil ? .add : .replace, path: "\(basePath)/affordances", value: wireJSON(affordances)))
    } else if oldNode.affordances != nil {
      ops.append(PatchOp(op: .remove, path: "\(basePath)/affordances"))
    }
  }

  if oldNode.meta != newNode.meta {
    if let meta = newNode.meta {
      ops.append(PatchOp(op: oldNode.meta == nil ? .add : .replace, path: "\(basePath)/meta", value: wireJSON(meta)))
    } else if oldNode.meta != nil {
      ops.append(PatchOp(op: .remove, path: "\(basePath)/meta"))
    }
  }

  if oldNode.contentRef != newNode.contentRef {
    if let contentRef = newNode.contentRef {
      ops.append(PatchOp(op: oldNode.contentRef == nil ? .add : .replace, path: "\(basePath)/content_ref", value: wireJSON(contentRef)))
    } else if oldNode.contentRef != nil {
      ops.append(PatchOp(op: .remove, path: "\(basePath)/content_ref"))
    }
  }

  let oldChildren = oldNode.children ?? []
  let newChildren = newNode.children ?? []
  let oldMap = oldChildren.reduce(into: [String: SlopNode]()) { map, child in
    map[child.id] = child
  }
  let newMap = newChildren.reduce(into: [String: SlopNode]()) { map, child in
    map[child.id] = child
  }

  var working: [String] = []
  for child in oldChildren {
    if newMap[child.id] == nil {
      ops.append(PatchOp(op: .remove, path: "\(basePath)/\(child.id)"))
    } else {
      working.append(child.id)
    }
  }

  for (index, child) in newChildren.enumerated() where oldMap[child.id] == nil {
    ops.append(PatchOp(op: .add, path: "\(basePath)/\(child.id)", value: wireJSON(child), index: index))
    working.insert(child.id, at: min(index, working.count))
  }

  for (index, child) in newChildren.enumerated() where working.indices.contains(index) && working[index] != child.id {
    guard let currentIndex = working[index...].firstIndex(of: child.id) else { continue }
    ops.append(PatchOp(op: .move, path: "\(basePath)/\(child.id)", index: index))
    working.remove(at: currentIndex)
    working.insert(child.id, at: index)
  }

  for child in newChildren {
    if let oldChild = oldMap[child.id] {
      ops.append(contentsOf: diffNodes(oldChild, child, basePath: "\(basePath)/\(child.id)"))
    }
  }

  return ops
}
