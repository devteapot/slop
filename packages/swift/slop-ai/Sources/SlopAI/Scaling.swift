import Foundation

public struct SubscriptionFilter: Equatable {
  public var types: [String]?
  public var minSalience: Double?

  public init(types: [String]? = nil, minSalience: Double? = nil) {
    self.types = types
    self.minSalience = minSalience
  }
}

public struct OutputTreeOptions: Equatable {
  public var maxDepth: Int?
  public var maxNodes: Int?
  public var minSalience: Double?
  public var types: [String]?

  public init(maxDepth: Int? = nil, maxNodes: Int? = nil, minSalience: Double? = nil, types: [String]? = nil) {
    self.maxDepth = maxDepth
    self.maxNodes = maxNodes
    self.minSalience = minSalience
    self.types = types
  }
}

public struct OutputRequest: Equatable {
  public var path: String?
  public var depth: Int?
  public var maxNodes: Int?
  public var filter: SubscriptionFilter?
  public var window: WindowRange?

  public init(
    path: String? = nil,
    depth: Int? = nil,
    maxNodes: Int? = nil,
    filter: SubscriptionFilter? = nil,
    window: WindowRange? = nil
  ) {
    self.path = path
    self.depth = depth
    self.maxNodes = maxNodes
    self.filter = filter
    self.window = window
  }
}

public func prepareTree(_ root: SlopNode, options: OutputTreeOptions) -> SlopNode {
  var tree = root
  if options.minSalience != nil || options.types != nil {
    tree = filterTree(tree, minSalience: options.minSalience, types: options.types)
  }
  if let maxDepth = options.maxDepth {
    tree = truncateTree(tree, depth: maxDepth)
  }
  if let maxNodes = options.maxNodes {
    tree = autoCompact(tree, maxNodes: maxNodes)
  }
  return tree
}

public func getSubtree(_ root: SlopNode, path: String) -> SlopNode? {
  if path.isEmpty || path == "/" {
    return root
  }

  let segments = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    .split(separator: "/")
    .map(String.init)
  var current = root
  for segment in segments {
    guard let child = current.children?.first(where: { $0.id == segment }) else {
      return nil
    }
    current = child
  }
  return current
}

public func truncateTree(_ node: SlopNode, depth: Int) -> SlopNode {
  if depth <= 0, let children = node.children, !children.isEmpty {
    var meta = node.meta ?? NodeMeta()
    meta.totalChildren = children.count
    return SlopNode(id: node.id, type: node.type, meta: meta)
  }
  guard let children = node.children else {
    return node
  }
  var copy = node
  copy.children = children.map { truncateTree($0, depth: depth - 1) }
  return copy
}

public func autoCompact(_ root: SlopNode, maxNodes: Int) -> SlopNode {
  let total = countNodes(root)
  guard total > maxNodes else { return root }

  var candidates: [CompactCandidate] = []
  if let children = root.children {
    for index in children.indices {
      collectCandidates(children[index], path: [index], candidates: &candidates, isRootChild: false)
    }
  }
  candidates.sort { $0.score < $1.score }

  var tree = root
  var nodeCount = total
  for candidate in candidates where nodeCount > maxNodes {
    let saved = collapseAtPath(&tree, path: candidate.path)
    nodeCount -= saved
  }
  return tree
}

public func filterTree(_ node: SlopNode, minSalience: Double? = nil, types: [String]? = nil) -> SlopNode {
  guard let children = node.children else { return node }
  let filtered = children
    .filter { child in
      if let minSalience {
        let salience = child.meta?.salience ?? 0.5
        if salience < minSalience { return false }
      }
      if let types, !types.contains(child.type) {
        return false
      }
      return true
    }
    .map { filterTree($0, minSalience: minSalience, types: types) }

  var copy = node
  copy.children = filtered.isEmpty ? nil : filtered
  return copy
}

public func countNodes(_ node: SlopNode) -> Int {
  1 + (node.children?.reduce(0) { $0 + countNodes($1) } ?? 0)
}

private struct CompactCandidate {
  var path: [Int]
  var score: Double
}

private func collectCandidates(_ node: SlopNode, path: [Int], candidates: inout [CompactCandidate], isRootChild: Bool) {
  guard let children = node.children else { return }
  for index in children.indices {
    let child = children[index]
    let childPath = path + [index]
    if let grandchildren = child.children, !grandchildren.isEmpty, !isRootChild, child.meta?.pinned != true {
      let childCount = countNodes(child) - 1
      let salience = child.meta?.salience ?? 0.5
      let depth = Double(childPath.count)
      let score = salience - depth * 0.01 - Double(childCount) * 0.001
      candidates.append(CompactCandidate(path: childPath, score: score))
    }
    collectCandidates(child, path: childPath, candidates: &candidates, isRootChild: false)
  }
}

private func collapseAtPath(_ tree: inout SlopNode, path: [Int]) -> Int {
  guard !path.isEmpty else { return 0 }
  return collapseAtPath(&tree, path: path, depth: 0)
}

private func collapseAtPath(_ node: inout SlopNode, path: [Int], depth: Int) -> Int {
  guard var children = node.children, path.indices.contains(depth), children.indices.contains(path[depth]) else {
    return 0
  }
  let index = path[depth]
  if depth == path.count - 1 {
    let target = children[index]
    let saved = countNodes(target) - 1
    var meta = target.meta ?? NodeMeta()
    meta.totalChildren = target.children?.count ?? 0
    if meta.summary == nil {
      meta.summary = "\(target.children?.count ?? 0) children"
    }
    children[index] = SlopNode(
      id: target.id,
      type: target.type,
      properties: target.properties,
      affordances: target.affordances,
      meta: meta,
      contentRef: target.contentRef
    )
    node.children = children
    return saved
  }
  let saved = collapseAtPath(&children[index], path: path, depth: depth + 1)
  node.children = children
  return saved
}
