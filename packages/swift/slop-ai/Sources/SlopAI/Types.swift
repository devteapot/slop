import Foundation

public enum SlopError: Error, Equatable, LocalizedError {
  case invalidNodeId(String)
  case duplicateNodeId(String)
  case notFound(String)
  case invalidParams(String)
  case subscriptionGap(expected: UInt64, received: UInt64)
  case internalError(String)

  public var errorDescription: String? {
    switch self {
    case .invalidNodeId(let message), .duplicateNodeId(let message), .notFound(let message), .invalidParams(let message), .internalError(let message):
      return message
    case .subscriptionGap(let expected, let received):
      return "SLOP subscription gap: expected seq \(expected), got \(received)"
    }
  }
}

public enum Urgency: String, Codable, Equatable {
  case none
  case low
  case medium
  case high
  case critical
}

public enum ActionEstimate: String, Codable, Equatable {
  case instant
  case fast
  case slow
  case async
}

public enum ContentRefType: String, Codable, Equatable {
  case text
  case binary
  case stream
}

public struct WindowRange: Codable, Equatable {
  public var offset: Int
  public var count: Int

  public init(_ offset: Int, _ count: Int) {
    self.offset = offset
    self.count = count
  }

  public init(from decoder: Decoder) throws {
    var container = try decoder.unkeyedContainer()
    offset = try container.decode(Int.self)
    count = try container.decode(Int.self)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.unkeyedContainer()
    try container.encode(offset)
    try container.encode(count)
  }
}

public struct NodeMeta: Codable, Equatable {
  public var summary: String?
  public var salience: Double?
  public var pinned: Bool?
  public var changed: Bool?
  public var focus: Bool?
  public var urgency: Urgency?
  public var reason: String?
  public var totalChildren: Int?
  public var window: WindowRange?
  public var created: String?
  public var updated: String?

  enum CodingKeys: String, CodingKey {
    case summary
    case salience
    case pinned
    case changed
    case focus
    case urgency
    case reason
    case totalChildren = "total_children"
    case window
    case created
    case updated
  }

  public init(
    summary: String? = nil,
    salience: Double? = nil,
    pinned: Bool? = nil,
    changed: Bool? = nil,
    focus: Bool? = nil,
    urgency: Urgency? = nil,
    reason: String? = nil,
    totalChildren: Int? = nil,
    window: WindowRange? = nil,
    created: String? = nil,
    updated: String? = nil
  ) {
    self.summary = summary
    self.salience = salience
    self.pinned = pinned
    self.changed = changed
    self.focus = focus
    self.urgency = urgency
    self.reason = reason
    self.totalChildren = totalChildren
    self.window = window
    self.created = created
    self.updated = updated
  }

  var isEmpty: Bool {
    summary == nil &&
      salience == nil &&
      pinned == nil &&
      changed == nil &&
      focus == nil &&
      urgency == nil &&
      reason == nil &&
      totalChildren == nil &&
      window == nil &&
      created == nil &&
      updated == nil
  }
}

public final class JSONSchema: Codable, Equatable {
  public var type: String
  public var properties: [String: JSONSchema]?
  public var required: [String]?
  public var items: JSONSchema?
  public var description: String?
  public var defaultValue: JSONValue?
  public var enumValues: [JSONValue]?

  enum CodingKeys: String, CodingKey {
    case type
    case properties
    case required
    case items
    case description
    case defaultValue = "default"
    case enumValues = "enum"
  }

  public init(
    type: String,
    properties: [String: JSONSchema]? = nil,
    required: [String]? = nil,
    items: JSONSchema? = nil,
    description: String? = nil,
    defaultValue: JSONValue? = nil,
    enumValues: [JSONValue]? = nil
  ) {
    self.type = type
    self.properties = properties
    self.required = required
    self.items = items
    self.description = description
    self.defaultValue = defaultValue
    self.enumValues = enumValues
  }

  public static func == (lhs: JSONSchema, rhs: JSONSchema) -> Bool {
    lhs.type == rhs.type &&
      lhs.properties == rhs.properties &&
      lhs.required == rhs.required &&
      lhs.items == rhs.items &&
      lhs.description == rhs.description &&
      lhs.defaultValue == rhs.defaultValue &&
      lhs.enumValues == rhs.enumValues
  }
}

public struct Affordance: Codable, Equatable {
  public var action: String
  public var label: String?
  public var description: String?
  public var params: JSONSchema?
  public var dangerous: Bool?
  public var idempotent: Bool?
  public var estimate: ActionEstimate?

  public init(
    action: String,
    label: String? = nil,
    description: String? = nil,
    params: JSONSchema? = nil,
    dangerous: Bool? = nil,
    idempotent: Bool? = nil,
    estimate: ActionEstimate? = nil
  ) {
    self.action = action
    self.label = label
    self.description = description
    self.params = params
    self.dangerous = dangerous
    self.idempotent = idempotent
    self.estimate = estimate
  }
}

public struct ContentRef: Codable, Equatable {
  public var type: ContentRefType
  public var mime: String
  public var summary: String
  public var size: Int?
  public var uri: String?
  public var preview: String?
  public var encoding: String?
  public var hash: String?

  public init(
    type: ContentRefType,
    mime: String,
    summary: String,
    size: Int? = nil,
    uri: String? = nil,
    preview: String? = nil,
    encoding: String? = nil,
    hash: String? = nil
  ) {
    self.type = type
    self.mime = mime
    self.summary = summary
    self.size = size
    self.uri = uri
    self.preview = preview
    self.encoding = encoding
    self.hash = hash
  }
}

public struct SlopNode: Codable, Equatable {
  public var id: String
  public var type: String
  public var properties: [String: JSONValue]?
  public var children: [SlopNode]?
  public var affordances: [Affordance]?
  public var meta: NodeMeta?
  public var contentRef: ContentRef?

  enum CodingKeys: String, CodingKey {
    case id
    case type
    case properties
    case children
    case affordances
    case meta
    case contentRef = "content_ref"
  }

  public init(
    id: String,
    type: String,
    properties: [String: JSONValue]? = nil,
    children: [SlopNode]? = nil,
    affordances: [Affordance]? = nil,
    meta: NodeMeta? = nil,
    contentRef: ContentRef? = nil
  ) {
    self.id = id
    self.type = type
    self.properties = properties
    self.children = children
    self.affordances = affordances
    self.meta = meta
    self.contentRef = contentRef
  }
}

public enum PatchOperation: String, Codable, Equatable {
  case add
  case remove
  case replace
  case move
}

public struct PatchOp: Codable, Equatable {
  public var op: PatchOperation
  public var path: String
  public var value: JSONValue?
  public var index: Int?

  public init(op: PatchOperation, path: String, value: JSONValue? = nil, index: Int? = nil) {
    self.op = op
    self.path = path
    self.value = value
    self.index = index
  }
}

public struct SnapshotMessage: Equatable {
  public var id: String
  public var version: UInt64
  public var seq: UInt64?
  public var tree: SlopNode

  public init(id: String, version: UInt64, seq: UInt64? = nil, tree: SlopNode) {
    self.id = id
    self.version = version
    self.seq = seq
    self.tree = tree
  }
}

public struct PatchMessage: Equatable {
  public var subscription: String
  public var version: UInt64
  public var seq: UInt64
  public var ops: [PatchOp]

  public init(subscription: String, version: UInt64, seq: UInt64, ops: [PatchOp]) {
    self.subscription = subscription
    self.version = version
    self.seq = seq
    self.ops = ops
  }
}

public struct ResultMessage: Equatable {
  public var id: String
  public var status: String
  public var data: JSONValue?
  public var error: [String: JSONValue]?

  public init(id: String, status: String, data: JSONValue? = nil, error: [String: JSONValue]? = nil) {
    self.id = id
    self.status = status
    self.data = data
    self.error = error
  }
}
