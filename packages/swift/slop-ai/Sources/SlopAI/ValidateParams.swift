import Foundation

/// Minimal JSON Schema validator for invoke params, matching the SDK subset.
public func validateParams(schema: JSONSchema?, params: JSONValue) -> String? {
  guard let schema else { return nil }
  return validate(schema, value: params, path: "params")
}

private func validate(_ schema: JSONSchema, value: JSONValue, path: String) -> String? {
  if let enumValues = schema.enumValues, !enumValues.contains(value) {
    return "\(path) must be one of \(canonicalJSON(.array(enumValues)))"
  }

  switch schema.type {
  case "object":
    guard case .object(let object) = value else {
      return "\(path) must be an object"
    }
    for key in schema.required ?? [] where object[key] == nil {
      return "\(path).\(key) is required"
    }
    for (key, propertySchema) in schema.properties ?? [:] {
      if let propertyValue = object[key], let error = validate(propertySchema, value: propertyValue, path: "\(path).\(key)") {
        return error
      }
    }
    return nil
  case "array":
    guard case .array(let array) = value else {
      return "\(path) must be an array"
    }
    if let itemSchema = schema.items {
      for (index, item) in array.enumerated() {
        if let error = validate(itemSchema, value: item, path: "\(path)[\(index)]") {
          return error
        }
      }
    }
    return nil
  case "string":
    return value.stringValue == nil ? "\(path) must be a string" : nil
  case "number":
    return value.doubleValue == nil ? "\(path) must be a number" : nil
  case "integer":
    guard let number = value.doubleValue, number.rounded(.towardZero) == number else {
      return "\(path) must be an integer"
    }
    return nil
  case "boolean":
    return value.boolValue == nil ? "\(path) must be a boolean" : nil
  case "null":
    return value == .null ? nil : "\(path) must be null"
  default:
    return nil
  }
}
