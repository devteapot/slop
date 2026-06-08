import Foundation

private let nodeFieldSegments: Set<String> = ["properties", "meta", "affordances", "content_ref"]

public final class StateMirror {
  private var tree: SlopNode
  private var version: UInt64
  private var seq: UInt64

  public init(snapshot: SnapshotMessage) {
    tree = snapshot.tree
    version = snapshot.version
    seq = snapshot.seq ?? 0
  }

  public func applyPatch(_ patch: PatchMessage) throws {
    if let patchSeq = patch.seq {
      let expected = seq + 1
      guard patchSeq == expected else {
        throw SlopError.subscriptionGap(expected: expected, received: patchSeq)
      }
      seq = patchSeq
    }

    for op in patch.ops {
      try apply(op)
    }
    version = patch.version
  }

  public func getTree() -> SlopNode {
    tree
  }

  public func getVersion() -> UInt64 {
    version
  }

  public func getSeq() -> UInt64 {
    seq
  }

  private func apply(_ op: PatchOp) throws {
    let segments = op.path.split(separator: "/").map(String.init)
    guard !segments.isEmpty else { return }

    if let fieldIndex = segments.firstIndex(where: { nodeFieldSegments.contains($0) }) {
      let nodePath = Array(segments[..<fieldIndex])
      let field = segments[fieldIndex]
      let fieldPath = Array(segments.dropFirst(fieldIndex + 1)).map(unescapeJSONPointerSegment)
      try withNode(at: nodePath) { node in
        try applyFieldOperation(op, field: field, fieldPath: fieldPath, node: &node)
      }
      return
    }

    switch op.op {
    case .add:
      try applyAddChild(segments: segments, value: op.value, index: op.index)
    case .remove:
      applyRemoveChild(segments: segments)
    case .replace:
      try applyReplaceChild(segments: segments, value: op.value)
    case .move:
      applyMoveChild(segments: segments, index: op.index)
    }
  }

  private func applyAddChild(segments: [String], value: JSONValue?, index: Int?) throws {
    guard let value else { return }
    let child = try decodeJSONValue(value, as: SlopNode.self)
    try withNode(at: Array(segments.dropLast())) { parent in
      var children = parent.children ?? []
      if let index {
        children.insert(child, at: max(0, min(index, children.count)))
      } else {
        children.append(child)
      }
      parent.children = children
    }
  }

  private func applyRemoveChild(segments: [String]) {
    guard let childID = segments.last else { return }
    try? withNode(at: Array(segments.dropLast())) { parent in
      parent.children = parent.children?.filter { $0.id != childID }
    }
  }

  private func applyReplaceChild(segments: [String], value: JSONValue?) throws {
    guard let value, let childID = segments.last else { return }
    let child = try decodeJSONValue(value, as: SlopNode.self)
    try withNode(at: Array(segments.dropLast())) { parent in
      guard var children = parent.children, let index = children.firstIndex(where: { $0.id == childID }) else {
        return
      }
      children[index] = child
      parent.children = children
    }
  }

  private func applyMoveChild(segments: [String], index: Int?) {
    guard let childID = segments.last, let index else { return }
    try? withNode(at: Array(segments.dropLast())) { parent in
      guard var children = parent.children, let currentIndex = children.firstIndex(where: { $0.id == childID }) else {
        return
      }
      let child = children.remove(at: currentIndex)
      children.insert(child, at: max(0, min(index, children.count)))
      parent.children = children
    }
  }

  private func withNode(at path: [String], _ body: (inout SlopNode) throws -> Void) throws {
    try withNode(at: path, in: &tree, body)
  }

  private func withNode(at path: [String], in node: inout SlopNode, _ body: (inout SlopNode) throws -> Void) throws {
    guard let first = path.first else {
      try body(&node)
      return
    }
    guard var children = node.children, let index = children.firstIndex(where: { $0.id == first }) else {
      return
    }
    try withNode(at: Array(path.dropFirst()), in: &children[index], body)
    node.children = children
  }
}

private func applyFieldOperation(_ op: PatchOp, field: String, fieldPath: [String], node: inout SlopNode) throws {
  switch field {
  case "properties":
    var value: JSONValue = .object(node.properties ?? [:])
    mutateJSONValue(&value, operation: op.op, path: fieldPath, replacement: op.value)
    node.properties = value.objectValue
  case "meta":
    if fieldPath.isEmpty {
      node.meta = op.op == .remove ? nil : try op.value.map { try decodeJSONValue($0, as: NodeMeta.self) }
    } else {
      var value = node.meta.map(wireJSON) ?? .object([:])
      mutateJSONValue(&value, operation: op.op, path: fieldPath, replacement: op.value)
      node.meta = try decodeJSONValue(value, as: NodeMeta.self)
    }
  case "affordances":
    if fieldPath.isEmpty {
      node.affordances = op.op == .remove ? nil : try op.value.map { try decodeJSONValue($0, as: [Affordance].self) }
    }
  case "content_ref":
    if fieldPath.isEmpty {
      node.contentRef = op.op == .remove ? nil : try op.value.map { try decodeJSONValue($0, as: ContentRef.self) }
    } else {
      var value = node.contentRef.map(wireJSON) ?? .object([:])
      mutateJSONValue(&value, operation: op.op, path: fieldPath, replacement: op.value)
      node.contentRef = try decodeJSONValue(value, as: ContentRef.self)
    }
  default:
    break
  }
}

private func mutateJSONValue(_ value: inout JSONValue, operation: PatchOperation, path: [String], replacement: JSONValue?) {
  guard let first = path.first else {
    switch operation {
    case .add, .replace:
      value = replacement ?? .null
    case .remove:
      value = .null
    case .move:
      break
    }
    return
  }

  if path.count == 1 {
    switch value {
    case .object(var object):
      switch operation {
      case .add, .replace:
        object[first] = replacement ?? .null
      case .remove:
        object.removeValue(forKey: first)
      case .move:
        break
      }
      value = .object(object)
    case .array(var array):
      guard let index = Int(first), array.indices.contains(index) else { return }
      switch operation {
      case .add, .replace:
        array[index] = replacement ?? .null
      case .remove:
        array.remove(at: index)
      case .move:
        break
      }
      value = .array(array)
    default:
      break
    }
    return
  }

  switch value {
  case .object(var object):
    var child = object[first] ?? .object([:])
    mutateJSONValue(&child, operation: operation, path: Array(path.dropFirst()), replacement: replacement)
    object[first] = child
    value = .object(object)
  case .array(var array):
    guard let index = Int(first), array.indices.contains(index) else { return }
    var child = array[index]
    mutateJSONValue(&child, operation: operation, path: Array(path.dropFirst()), replacement: replacement)
    array[index] = child
    value = .array(array)
  default:
    break
  }
}
