import Foundation

public enum ActionResult: Equatable {
  case value(JSONValue?)
  case accepted(taskId: String, data: [String: JSONValue] = [:])
}

public typealias ActionHandler = ([String: JSONValue]) async throws -> ActionResult

public enum ParamDef: Equatable {
  case type(String)
  case schema(JSONSchema)
}

public struct Action {
  public var handler: ActionHandler
  public var params: [String: ParamDef]?
  public var label: String?
  public var description: String?
  public var dangerous: Bool
  public var idempotent: Bool
  public var estimate: ActionEstimate?

  public init(
    params: [String: ParamDef]? = nil,
    label: String? = nil,
    description: String? = nil,
    dangerous: Bool = false,
    idempotent: Bool = false,
    estimate: ActionEstimate? = nil,
    handler: @escaping ActionHandler
  ) {
    self.handler = handler
    self.params = params
    self.label = label
    self.description = description
    self.dangerous = dangerous
    self.idempotent = idempotent
    self.estimate = estimate
  }

  public static func value(
    params: [String: ParamDef]? = nil,
    label: String? = nil,
    description: String? = nil,
    dangerous: Bool = false,
    idempotent: Bool = false,
    estimate: ActionEstimate? = nil,
    _ handler: @escaping ([String: JSONValue]) async throws -> JSONValue?
  ) -> Action {
    Action(
      params: params,
      label: label,
      description: description,
      dangerous: dangerous,
      idempotent: idempotent,
      estimate: estimate
    ) { params in
      .value(try await handler(params))
    }
  }
}

public struct WindowDescriptor {
  public var items: [ItemDescriptor]
  public var total: Int
  public var offset: Int

  public init(items: [ItemDescriptor], total: Int, offset: Int) {
    self.items = items
    self.total = total
    self.offset = offset
  }
}

public struct ItemDescriptor {
  public var id: String
  public var type: String
  public var props: [String: JSONValue]?
  public var summary: String?
  public var actions: [String: Action]?
  public var meta: NodeMeta?
  public var children: [String: NodeDescriptor]?
  public var contentRef: ContentRef?

  public init(
    id: String,
    type: String = "item",
    props: [String: JSONValue]? = nil,
    summary: String? = nil,
    actions: [String: Action]? = nil,
    meta: NodeMeta? = nil,
    children: [String: NodeDescriptor]? = nil,
    contentRef: ContentRef? = nil
  ) {
    self.id = id
    self.type = type
    self.props = props
    self.summary = summary
    self.actions = actions
    self.meta = meta
    self.children = children
    self.contentRef = contentRef
  }
}

public struct NodeDescriptor {
  public var type: String
  public var props: [String: JSONValue]?
  public var summary: String?
  public var items: [ItemDescriptor]?
  public var window: WindowDescriptor?
  public var contentRef: ContentRef?
  public var children: [String: NodeDescriptor]?
  public var actions: [String: Action]?
  public var meta: NodeMeta?

  public init(
    type: String,
    props: [String: JSONValue]? = nil,
    summary: String? = nil,
    items: [ItemDescriptor]? = nil,
    window: WindowDescriptor? = nil,
    contentRef: ContentRef? = nil,
    children: [String: NodeDescriptor]? = nil,
    actions: [String: Action]? = nil,
    meta: NodeMeta? = nil
  ) {
    self.type = type
    self.props = props
    self.summary = summary
    self.items = items
    self.window = window
    self.contentRef = contentRef
    self.children = children
    self.actions = actions
    self.meta = meta
  }
}

public struct NormalizationResult {
  public var node: SlopNode
  public var handlers: [String: ActionHandler]
}

/// Convert a developer-friendly descriptor into a wire-format node and action handler map.
public func normalizeDescriptor(path: String, id: String, descriptor: NodeDescriptor) throws -> NormalizationResult {
  try validateNodeID(id)
  var handlers: [String: ActionHandler] = [:]
  var children: [SlopNode] = []
  var childIDs: Set<String> = []
  var meta = descriptor.meta ?? NodeMeta()
  if let summary = descriptor.summary {
    meta.summary = summary
  }

  if let window = descriptor.window {
    for item in window.items {
      try reserveChildID(item.id, parentPath: path, childIDs: &childIDs)
      let itemPath = path.isEmpty ? item.id : "\(path)/\(item.id)"
      let result = try normalizeItem(path: itemPath, item: item)
      children.append(result.node)
      handlers.merge(result.handlers) { _, new in new }
    }
    meta.totalChildren = window.total
    meta.window = WindowRange(window.offset, window.items.count)
  } else if let items = descriptor.items {
    for item in items {
      try reserveChildID(item.id, parentPath: path, childIDs: &childIDs)
      let itemPath = path.isEmpty ? item.id : "\(path)/\(item.id)"
      let result = try normalizeItem(path: itemPath, item: item)
      children.append(result.node)
      handlers.merge(result.handlers) { _, new in new }
    }
  }

  if let childDescriptors = descriptor.children {
    for childID in childDescriptors.keys.sorted() {
      guard let childDescriptor = childDescriptors[childID] else { continue }
      try reserveChildID(childID, parentPath: path, childIDs: &childIDs)
      let childPath = path.isEmpty ? childID : "\(path)/\(childID)"
      let result = try normalizeDescriptor(path: childPath, id: childID, descriptor: childDescriptor)
      children.append(result.node)
      handlers.merge(result.handlers) { _, new in new }
    }
  }

  let affordances = normalizeActions(path: path, actions: descriptor.actions, handlers: &handlers)
  var contentRef = descriptor.contentRef
  if contentRef != nil && contentRef?.uri == nil {
    contentRef?.uri = "slop://content/\(path)"
  }

  return NormalizationResult(
    node: SlopNode(
      id: id,
      type: descriptor.type,
      properties: descriptor.props,
      children: children.isEmpty ? nil : children,
      affordances: affordances.isEmpty ? nil : affordances,
      meta: meta.isEmpty ? nil : meta,
      contentRef: contentRef
    ),
    handlers: handlers
  )
}

private func reserveChildID(_ id: String, parentPath: String, childIDs: inout Set<String>) throws {
  guard childIDs.insert(id).inserted else {
    let parent = parentPath.isEmpty ? "/" : "/\(parentPath)"
    throw SlopError.duplicateNodeId("Duplicate child id \"\(id)\" under \(parent)")
  }
}

private func normalizeItem(path: String, item: ItemDescriptor) throws -> NormalizationResult {
  try validateNodeID(item.id)
  var handlers: [String: ActionHandler] = [:]
  var children: [SlopNode] = []

  if let childDescriptors = item.children {
    for childID in childDescriptors.keys.sorted() {
      guard let childDescriptor = childDescriptors[childID] else { continue }
      let result = try normalizeDescriptor(path: "\(path)/\(childID)", id: childID, descriptor: childDescriptor)
      children.append(result.node)
      handlers.merge(result.handlers) { _, new in new }
    }
  }

  let affordances = normalizeActions(path: path, actions: item.actions, handlers: &handlers)
  var meta = item.meta ?? NodeMeta()
  if let summary = item.summary {
    meta.summary = summary
  }
  var contentRef = item.contentRef
  if contentRef != nil && contentRef?.uri == nil {
    contentRef?.uri = "slop://content/\(path)"
  }

  return NormalizationResult(
    node: SlopNode(
      id: item.id,
      type: item.type,
      properties: item.props,
      children: children.isEmpty ? nil : children,
      affordances: affordances.isEmpty ? nil : affordances,
      meta: meta.isEmpty ? nil : meta,
      contentRef: contentRef
    ),
    handlers: handlers
  )
}

private func normalizeActions(path: String, actions: [String: Action]?, handlers: inout [String: ActionHandler]) -> [Affordance] {
  guard let actions else { return [] }
  var affordances: [Affordance] = []
  for name in actions.keys.sorted() {
    guard let action = actions[name] else { continue }
    let handlerKey = path.isEmpty ? name : "\(path)/\(name)"
    handlers[handlerKey] = action.handler
    affordances.append(
      Affordance(
        action: name,
        label: action.label,
        description: action.description,
        params: action.params.map(normalizeParams),
        dangerous: action.dangerous ? true : nil,
        idempotent: action.idempotent ? true : nil,
        estimate: action.estimate
      )
    )
  }
  return affordances
}

public func normalizeParams(_ params: [String: ParamDef]) -> JSONSchema {
  var properties: [String: JSONSchema] = [:]
  var required: [String] = []

  for key in params.keys.sorted() {
    guard let definition = params[key] else { continue }
    switch definition {
    case .type(let type):
      properties[key] = JSONSchema(type: type)
    case .schema(let schema):
      properties[key] = schema
    }
    required.append(key)
  }

  return JSONSchema(type: "object", properties: properties, required: required)
}
