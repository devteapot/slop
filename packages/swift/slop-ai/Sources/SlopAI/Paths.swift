let reservedNodeIDs: Set<String> = [
  "properties",
  "children",
  "affordances",
  "meta",
  "content_ref",
  "id",
  "type",
]

public func escapeJSONPointerSegment(_ segment: String) -> String {
  segment.replacingOccurrences(of: "~", with: "~0")
    .replacingOccurrences(of: "/", with: "~1")
}

public func unescapeJSONPointerSegment(_ segment: String) -> String {
  segment.replacingOccurrences(of: "~1", with: "/")
    .replacingOccurrences(of: "~0", with: "~")
}

public func validateNodeID(_ id: String) throws {
  if id.isEmpty {
    throw SlopError.invalidNodeId("SLOP node id must be a non-empty string")
  }
  if reservedNodeIDs.contains(id) {
    throw SlopError.invalidNodeId(
      "SLOP node id \"\(id)\" collides with a reserved field keyword (properties, children, affordances, meta, content_ref, id, type)"
    )
  }
  if id.contains("/") || id.contains("~") {
    throw SlopError.invalidNodeId("SLOP node id \"\(id)\" must not contain \"/\" or \"~\"; these are reserved in patch paths")
  }
}

public func isValidNodeID(_ id: String) -> Bool {
  (try? validateNodeID(id)) != nil
}
