import Foundation

public func pick(_ object: [String: JSONValue], keys: some Sequence<String>) -> [String: JSONValue] {
  let keySet = Set(keys)
  return object.filter { keySet.contains($0.key) }
}

public func omit(_ object: [String: JSONValue], keys: some Sequence<String>) -> [String: JSONValue] {
  let keySet = Set(keys)
  return object.filter { !keySet.contains($0.key) }
}

public func action(
  params: [String: ParamDef],
  label: String? = nil,
  description: String? = nil,
  dangerous: Bool = false,
  idempotent: Bool = false,
  estimate: ActionEstimate? = nil,
  handler: @escaping ([String: JSONValue]) async throws -> JSONValue?
) -> Action {
  Action.value(
    params: params,
    label: label,
    description: description,
    dangerous: dangerous,
    idempotent: idempotent,
    estimate: estimate,
    handler
  )
}

public func action(
  label: String? = nil,
  description: String? = nil,
  dangerous: Bool = false,
  idempotent: Bool = false,
  estimate: ActionEstimate? = nil,
  handler: @escaping ([String: JSONValue]) async throws -> JSONValue?
) -> Action {
  Action.value(
    label: label,
    description: description,
    dangerous: dangerous,
    idempotent: idempotent,
    estimate: estimate,
    handler
  )
}
