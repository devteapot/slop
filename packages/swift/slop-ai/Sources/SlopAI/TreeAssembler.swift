import Foundation

public struct AssemblyResult {
  public var tree: SlopNode
  public var handlers: [String: ActionHandler]
}

public func assembleTree(
  registrations: [String: NodeDescriptor],
  rootID: String,
  rootName: String
) throws -> AssemblyResult {
  try validateNodeID(rootID)
  for path in registrations.keys {
    for segment in path.split(separator: "/").map(String.init) {
      try validateNodeID(segment)
    }
  }

  var allHandlers: [String: ActionHandler] = [:]
  var nodesByPath: [String: SlopNode] = [:]
  let sortedPaths = registrations.keys.sorted { lhs, rhs in
    let lhsDepth = lhs.split(separator: "/").count
    let rhsDepth = rhs.split(separator: "/").count
    return lhsDepth == rhsDepth ? lhs < rhs : lhsDepth < rhsDepth
  }

  for path in sortedPaths {
    guard let descriptor = registrations[path], let id = path.split(separator: "/").last.map(String.init) else {
      continue
    }
    let result = try normalizeDescriptor(path: path, id: id, descriptor: descriptor)
    nodesByPath[path] = result.node
    allHandlers.merge(result.handlers) { _, new in new }
  }

  var root = SlopNode(id: rootID, type: "root", properties: ["label": .string(rootName)], children: [])
  for path in sortedPaths {
    guard let node = nodesByPath[path] else { continue }
    let parentPath = getParentPath(path)
    if parentPath.isEmpty {
      addChild(parent: &root, child: node)
    } else {
      _ = ensureNode(path: parentPath, nodesByPath: &nodesByPath, root: &root)
      if var parent = nodesByPath[parentPath] {
        addChild(parent: &parent, child: node)
        nodesByPath[parentPath] = parent
        replaceNode(path: parentPath, with: parent, in: &root)
      }
    }
  }

  return AssemblyResult(tree: root, handlers: allHandlers)
}

private func getParentPath(_ path: String) -> String {
  guard let lastSlash = path.lastIndex(of: "/") else { return "" }
  return String(path[..<lastSlash])
}

@discardableResult
private func ensureNode(path: String, nodesByPath: inout [String: SlopNode], root: inout SlopNode) -> SlopNode {
  if let existing = nodesByPath[path] {
    return existing
  }

  let id = path.split(separator: "/").last.map(String.init) ?? path
  var synthetic = SlopNode(id: id, type: "group", children: [])
  nodesByPath[path] = synthetic

  let parentPath = getParentPath(path)
  if parentPath.isEmpty {
    addChild(parent: &root, child: synthetic)
  } else {
    _ = ensureNode(path: parentPath, nodesByPath: &nodesByPath, root: &root)
    if var parent = nodesByPath[parentPath] {
      addChild(parent: &parent, child: synthetic)
      nodesByPath[parentPath] = parent
      replaceNode(path: parentPath, with: parent, in: &root)
    }
  }

  synthetic = nodesByPath[path] ?? synthetic
  return synthetic
}

private func addChild(parent: inout SlopNode, child: SlopNode) {
  if parent.children == nil {
    parent.children = []
  }

  guard let existingIndex = parent.children?.firstIndex(where: { $0.id == child.id }) else {
    parent.children?.append(child)
    return
  }

  var replacement = child
  let existing = parent.children![existingIndex]
  if existing.type == "group", existing.properties == nil {
    if let existingChildren = existing.children, !existingChildren.isEmpty {
      if replacement.children == nil || replacement.children?.isEmpty == true {
        replacement.children = existingChildren
      } else {
        let childIDs = Set(replacement.children?.map(\.id) ?? [])
        for existingChild in existingChildren where !childIDs.contains(existingChild.id) {
          replacement.children?.append(existingChild)
        }
      }
    }
  }
  parent.children![existingIndex] = replacement
}

private func replaceNode(path: String, with replacement: SlopNode, in root: inout SlopNode) {
  let segments = path.split(separator: "/").map(String.init)
  replaceNode(segments: segments, with: replacement, in: &root)
}

private func replaceNode(segments: [String], with replacement: SlopNode, in node: inout SlopNode) {
  guard !segments.isEmpty else {
    node = replacement
    return
  }
  guard var children = node.children, let index = children.firstIndex(where: { $0.id == segments[0] }) else {
    return
  }
  if segments.count == 1 {
    children[index] = replacement
  } else {
    replaceNode(segments: Array(segments.dropFirst()), with: replacement, in: &children[index])
  }
  node.children = children
}
