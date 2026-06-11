import Foundation

/// A type-safe representation of JSON values used at SLOP wire boundaries.
public enum JSONValue: Equatable, Codable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Int.self) {
      self = .number(Double(value))
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSONValue].self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null:
      try container.encodeNil()
    case .bool(let value):
      try container.encode(value)
    case .number(let value):
      guard value.isFinite else {
        throw EncodingError.invalidValue(
          value,
          EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "JSON numbers must be finite")
        )
      }
      try container.encode(value)
    case .string(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    }
  }

  public var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var intValue: Int? {
    if case .number(let value) = self { return Int(exactly: value) }
    return nil
  }

  public var doubleValue: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  public var boolValue: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let value) = self { return value }
    return nil
  }

  public var objectValue: [String: JSONValue]? {
    if case .object(let value) = self { return value }
    return nil
  }

  var isEmptyObject: Bool {
    if case .object(let value) = self { return value.isEmpty }
    return false
  }
}

extension JSONValue: ExpressibleByNilLiteral {
  public init(nilLiteral: ()) {
    self = .null
  }
}

extension JSONValue: ExpressibleByBooleanLiteral {
  public init(booleanLiteral value: Bool) {
    self = .bool(value)
  }
}

extension JSONValue: ExpressibleByIntegerLiteral {
  public init(integerLiteral value: Int) {
    self = .number(Double(value))
  }
}

extension JSONValue: ExpressibleByFloatLiteral {
  public init(floatLiteral value: Double) {
    self = .number(value)
  }
}

extension JSONValue: ExpressibleByStringLiteral {
  public init(stringLiteral value: String) {
    self = .string(value)
  }
}

extension JSONValue: ExpressibleByArrayLiteral {
  public init(arrayLiteral elements: JSONValue...) {
    self = .array(elements)
  }
}

extension JSONValue: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self = .object(Dictionary(uniqueKeysWithValues: elements))
  }
}

func encodeToJSONValue<T: Encodable>(_ value: T) throws -> JSONValue {
  let data = try JSONEncoder().encode(value)
  return try JSONDecoder().decode(JSONValue.self, from: data)
}

func decodeJSONValue<T: Decodable>(_ value: JSONValue, as type: T.Type) throws -> T {
  let data = try JSONEncoder().encode(value)
  return try JSONDecoder().decode(type, from: data)
}

func wireJSON<T: Encodable>(_ value: T) -> JSONValue {
  (try? encodeToJSONValue(value)) ?? .null
}

func canonicalJSON(_ value: JSONValue) -> String {
  switch value {
  case .null:
    return "null"
  case .bool(let value):
    return value ? "true" : "false"
  case .number(let value):
    return Int(exactly: value).map(String.init) ?? String(value)
  case .string(let value):
    return String(data: try! JSONEncoder().encode(value), encoding: .utf8) ?? "\"\""
  case .array(let values):
    return "[\(values.map(canonicalJSON).joined(separator: ","))]"
  case .object(let object):
    return "{\(object.keys.sorted().map { "\(canonicalJSON(.string($0))):\(canonicalJSON(object[$0]!))" }.joined(separator: ","))}"
  }
}
