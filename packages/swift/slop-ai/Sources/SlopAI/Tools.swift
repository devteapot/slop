import Foundation

public struct LLMTool: Equatable {
  public struct Function: Equatable {
    public var name: String
    public var description: String
    public var parameters: JSONSchema

    public init(name: String, description: String, parameters: JSONSchema) {
      self.name = name
      self.description = description
      self.parameters = parameters
    }
  }

  public var type: String
  public var function: Function

  public init(type: String = "function", function: Function) {
    self.type = type
    self.function = function
  }
}

public struct ToolResolution: Equatable {
  public var path: String?
  public var action: String
  public var targets: [String]?

  public init(path: String?, action: String, targets: [String]? = nil) {
    self.path = path
    self.action = action
    self.targets = targets
  }
}

public struct ToolSet {
  public var tools: [LLMTool]
  private var resolveMap: [String: ToolResolution]

  public init(tools: [LLMTool], resolveMap: [String: ToolResolution]) {
    self.tools = tools
    self.resolveMap = resolveMap
  }

  public func resolve(_ toolName: String) -> ToolResolution? {
    resolveMap[toolName]
  }
}

private struct AffordanceEntry {
  var nodeID: String
  var nodeType: String
  var path: String
  var action: String
  var affordance: Affordance
  var schemaKey: String
}

public func affordancesToTools(_ node: SlopNode, path: String = "") -> ToolSet {
  var entries: [AffordanceEntry] = []
  collectAffordances(node, path: path, entries: &entries)

  let groups = Dictionary(grouping: entries) { "\($0.action)\u{0}\($0.schemaKey)" }
    .values
    .map { Array($0) }

  var actionNameCounts: [String: Int] = [:]
  for group in groups {
    guard let first = group.first else { continue }
    let action = sanitize(first.action)
    actionNameCounts[action, default: 0] += 1
  }

  var actionNameUsed: [String: Int] = [:]
  var resolveMap: [String: ToolResolution] = [:]
  var tools: [LLMTool] = []
  var usedToolNames: Set<String> = []

  for group in groups.sorted(by: {
    let lhs = $0.first.map { "\($0.action)\u{0}\($0.schemaKey)\u{0}\($0.nodeID)" } ?? ""
    let rhs = $1.first.map { "\($0.action)\u{0}\($0.schemaKey)\u{0}\($0.nodeID)" } ?? ""
    return lhs < rhs
  }) {
    guard let first = group.first else { continue }
    let safeAction = sanitize(first.action)

    if group.count == 1 {
      let toolName = reserveToolName("\(sanitize(first.nodeID))__\(safeAction)", used: &usedToolNames)
      resolveMap[toolName] = ToolResolution(path: first.path.isEmpty ? "/" : first.path, action: first.action)
      tools.append(
        LLMTool(
          function: .init(
            name: toolName,
            description: buildDescription(first),
            parameters: first.affordance.params ?? JSONSchema(type: "object", properties: [:])
          )
        )
      )
      continue
    }

    var toolName = safeAction
    if (actionNameCounts[safeAction] ?? 0) > 1 {
      let used = actionNameUsed[safeAction] ?? 0
      actionNameUsed[safeAction] = used + 1
      if used > 0 {
        toolName = "\(safeAction)__\(sanitize(first.nodeID))"
      }
    }
    toolName = reserveToolName(toolName, used: &usedToolNames)

    let targets = group.map { $0.path.isEmpty ? "/" : $0.path }
    let baseParams = cloneSchema(first.affordance.params ?? JSONSchema(type: "object", properties: [:]))
    var properties = baseParams.properties ?? [:]
    properties["target"] = JSONSchema(
      type: "string",
      description: "Path to the target node (e.g. \(targets[0])). See the state tree for valid paths."
    )
    baseParams.properties = properties
    baseParams.required = ["target"] + (baseParams.required ?? [])

    resolveMap[toolName] = ToolResolution(path: nil, action: first.action, targets: targets)
    tools.append(
      LLMTool(
        function: .init(
          name: toolName,
          description: buildGroupDescription(group),
          parameters: baseParams
        )
      )
    )
  }

  return ToolSet(tools: tools, resolveMap: resolveMap)
}

public func formatTree(_ node: SlopNode, indent: Int = 0) -> String {
  let pad = String(repeating: "  ", count: indent)
  let properties = node.properties ?? [:]
  let displayName = properties["label"]?.stringValue ?? properties["title"]?.stringValue
  let header = displayName != nil && displayName != node.id ? "\(node.id): \(displayName!)" : node.id
  let extra = properties.keys
    .sorted()
    .filter { $0 != "label" && $0 != "title" }
    .map { "\($0)=\(canonicalJSON(properties[$0]!))" }
    .joined(separator: ", ")

  let affordances = (node.affordances ?? [])
    .map { affordance in
      var string = affordance.action
      if let properties = affordance.params?.properties {
        let params = properties.keys.sorted().map { "\($0): \(properties[$0]!.type)" }.joined(separator: ", ")
        string += "(\(params))"
      }
      return string
    }
    .joined(separator: ", ")

  var line = "\(pad)[\(node.type)] \(header)"
  if !extra.isEmpty {
    line += " (\(extra))"
  }
  if let summary = node.meta?.summary {
    line += "  — \"\(summary)\""
  }
  if let salience = node.meta?.salience {
    line += "  salience=\((salience * 100).rounded() / 100)"
  }
  if !affordances.isEmpty {
    line += "  actions: {\(affordances)}"
  }

  var lines = [line]
  let childCount = node.children?.count ?? 0
  if let totalChildren = node.meta?.totalChildren, totalChildren > childCount {
    if node.meta?.window != nil {
      lines.append("\(pad)  (showing \(childCount) of \(totalChildren))")
    } else if childCount == 0 {
      lines.append("\(pad)  (\(totalChildren) \(totalChildren == 1 ? "child" : "children") not loaded)")
    }
  }
  for child in node.children ?? [] {
    lines.append(formatTree(child, indent: indent + 1))
  }
  return lines.joined(separator: "\n")
}

private func collectAffordances(_ node: SlopNode, path: String, entries: inout [AffordanceEntry]) {
  for affordance in node.affordances ?? [] {
    entries.append(
      AffordanceEntry(
        nodeID: node.id,
        nodeType: node.type,
        path: path,
        action: affordance.action,
        affordance: affordance,
        schemaKey: canonicalSchemaKey(affordance.params)
      )
    )
  }
  for child in node.children ?? [] {
    collectAffordances(child, path: "\(path)/\(child.id)", entries: &entries)
  }
}

private func sanitize(_ value: String) -> String {
  String(value.unicodeScalars.map { scalar -> Character in
    let value = scalar.value
    let isASCIIAlphaNumeric = (48...57).contains(value) || (65...90).contains(value) || (97...122).contains(value)
    return isASCIIAlphaNumeric ? Character(String(scalar)) : "_"
  })
}

private func reserveToolName(_ base: String, used: inout Set<String>) -> String {
  if used.insert(base).inserted {
    return base
  }
  var suffix = 2
  while !used.insert("\(base)__\(suffix)").inserted {
    suffix += 1
  }
  return "\(base)__\(suffix)"
}

private func canonicalSchemaKey(_ schema: JSONSchema?) -> String {
  guard let schema else { return "" }
  return canonicalJSON(wireJSON(schema))
}

private func buildDescription(_ entry: AffordanceEntry) -> String {
  var description = "\(entry.affordance.label ?? entry.affordance.action)"
  if let detail = entry.affordance.description {
    description += ": \(detail)"
  }
  description += " (on \(entry.path.isEmpty ? "/" : entry.path))"
  if entry.affordance.dangerous == true {
    description += " [DANGEROUS - confirm first]"
  }
  return description
}

private func buildGroupDescription(_ group: [AffordanceEntry]) -> String {
  guard let first = group.first else { return "" }
  var description = first.affordance.label ?? first.affordance.action
  if let detail = first.affordance.description {
    description += ": \(detail)"
  }
  description += " (\(group.count) targets)"
  if group.contains(where: { $0.affordance.dangerous == true }) {
    description += " [DANGEROUS - confirm first]"
  }
  return description
}

private func cloneSchema(_ schema: JSONSchema) -> JSONSchema {
  (try? decodeJSONValue(wireJSON(schema), as: JSONSchema.self)) ?? JSONSchema(type: schema.type)
}
